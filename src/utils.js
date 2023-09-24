const fs = require('fs-extra')

const exts = ['.ts', '.tsx', '.d.ts']
const extReg = /\.tsx?$/

function resolve(p) {
  const exist = fs.existsSync(p)
  if (exist && fs.statSync(p).isDirectory()) {
    return resolve(p + '/index')
  }
  if (exist) {
    return p
  }
  for (const ext of exts) {
    if (fs.existsSync(p + ext)) {
      return p + ext
    }
  }

  throw new Error('文件不存在: ' + p)
}

module.exports = {
  resolve,
  extReg
}
