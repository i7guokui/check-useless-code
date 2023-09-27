const fs = require('fs-extra')
const path = require('path')
const { globSync } = require('glob')
const { extReg, resolve } = require('./utils')
const ts = require('typescript')

const cwd = process.cwd()

const configPath = path.resolve(cwd, 'cuc.config.js')

const isConfigExist = fs.existsSync(configPath)

if (!isConfigExist) {
  throw new Error('Please create a config file named `cuc.config.js` in the project directory')
}

/**
 * @type {{ entryPoints: string[]; alias: Record<string, string> }}
 * @example 
 * module.exports = {
    entryPoints: [
      'src/app.tsx',
      'src/layouts/index.tsx',
      'src/routes/index.ts',
      '@/pages/notFound',
    ],
    alias: {
      '@/': 'src/'
    }
  }
 */
const config = require(configPath)

const { entryPoints = [], alias = {} } = config
const aliasKeys = Object.keys(alias)

// 保存 src 下全部文件路径 ts tsx
const allFiles = globSync(path.resolve(cwd, 'src/**/*')).filter(p => !fs.statSync(p).isDirectory() && extReg.test(p))

// 文件内容的导入导出记录
const depsMap = allFiles.reduce((acc, cur) => {
  acc.set(cur, {
    // 自身 export 的内容
    exports: undefined,
    // 被其他模块 import 的内容
    imports: new Set(),
  })
  return acc
}, new Map())

// 入口文件 path 的集合
const entrySet = new Set()
// 从入口文件开始查找记录被使用到的文件
const deps = new Set()
// 记录解析的 ast，避免重复解析
const astMap = new Map()

// 单个文件处理
async function handleFile(filePath) {
  let ast = astMap.get(filePath)
  if (!ast) {
    const contents = await fs.readFile(filePath, { encoding: 'utf-8' })
    ast = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest)
    astMap.set(filePath, ast)
    const exportsSet = new Set()
    for (const node of ast.statements) {
      let importPath = '', replaced = false
      if (node.moduleSpecifier) {
        [importPath, replaced] = replaceAlias(node.moduleSpecifier.text)
        if (replaced) { // 匹配别名
          importPath = resolve(path.resolve(cwd, importPath))
        } else if (importPath.startsWith('.')) { // 匹配相对路径
          importPath = resolve(path.resolve(path.dirname(filePath), importPath))
        } else { // 第三方库
          continue
        }
        if (!extReg.test(importPath)) { // 非 ts tsx 不处理
          continue
        }
        // 记录被 import 的文件
        deps.add(importPath)
        await handleFile(importPath, filePath)
      }
      const ips = depsMap.get(importPath)?.imports
      if (ts.isImportDeclaration(node)) {
        if (node.importClause?.namedBindings?.name) {
          // import * as B from 'react'
          // 当做全部导出都被使用
          depsMap.get(importPath).imports = depsMap.get(importPath).exports
        } else {
          // import B from 'react'
          if (node.importClause.name) {
            ips.add('default')
          }
          node.importClause?.namedBindings?.elements?.forEach(it => {
            // import { ReactNode, FC as FB } from 'react'
            ips.add(it?.propertyName?.escapedText ?? it.name.escapedText)
          })
        }
      } else if (ts.isExportAssignment(node)) { // export default A
        exportsSet.add('default')
      } else if (ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) {
          if (node.exportClause) {
            // export { A, B as C } from './test'
            node.exportClause?.elements?.forEach(it => {
              ips.add(it.propertyName?.escapedText ?? it.name.escapedText)
            })
          } else {
            // export * from './test'
            depsMap.get(importPath)?.exports?.forEach(it => {
              // import 文件的被导入记录中添加自身全部导出内容
              ips.add(it)
              // 当前文件的导出记录中添加 import 文件的全部导出内容
              exportsSet.add(it)
            })
          }
        } else {
          // export { A, B as C }
          node.exportClause?.elements?.forEach(it => {
            exportsSet.add(it.name.escapedText)
          })
        }
      } else if (ts.isVariableStatement(node)) {
        if (node.modifiers?.some(it => it.kind === ts.SyntaxKind.ExportKeyword)) {
          node.declarationList.declarations.forEach(it => {
            if (it.name.kind === ts.SyntaxKind.ObjectBindingPattern) { // export const { a } = info
              it.name.elements.forEach(bindEl => {
                exportsSet.add(bindEl.name.escapedText)
              })
            } else if (it.name.escapedText) { // export const a = 1
              exportsSet.add(it.name.escapedText)
            }
          })
        }
      } else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) { // export interface | type | enum | class | function
        if (node.modifiers?.some(it => it.kind === ts.SyntaxKind.ExportKeyword)) {
          exportsSet.add(node.name.escapedText)
        }
      }
    }
    depsMap.get(filePath).exports = exportsSet
  }
}

async function start() {
  for (const entry of entryPoints) {
    let id = replaceAlias(entry)[0]
    id = resolve(path.resolve(cwd, id))
    // 加入入口文件路径集合
    entrySet.add(id)
    // 入口文件加入被使用到的文件集合
    deps.add(id)
    await handleFile(id)
  }
}

start().then(() => {
  const uselessFiles = allFiles.filter(p => !deps.has(p))
  if (uselessFiles.length) {
    console.log('Useless files：')
    console.log(uselessFiles)
  }
  const usedFiles = allFiles.filter(p => deps.has(p) && !entrySet.has(p))
  const uselessExports = usedFiles.reduce((acc, cur) => {
    const item = depsMap.get(cur)
    const { exports = new Set(), imports } = item
    if (exports.size !== imports.size) {
      const unused = []
      exports.forEach(item => {
        if (!imports.has(item)) {
          unused.push(item)
        }
      })
      acc.push(`${cur} ${unused.join(' ')}`)
    }
    return acc
  }, [])
  if (uselessExports.length) {
    console.log('Useless exports：')
    console.log(uselessExports)
  }
})

function replaceAlias(id) {
  const prefix = aliasKeys.find((k) => id.startsWith(k))
  if (prefix) {
    id = alias[prefix] + id.substring(prefix.length)
  }
  return [id, !!prefix]
}
