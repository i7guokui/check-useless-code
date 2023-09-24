# Check useless code

Detect useless code in the project, currently only supports ts and tsx code.

## Usage
1. Clone this repository
2. Enter the directory and install the dependencies
```bash
cd check-useless-code
pnpm i
```
3. Link package to global `node_modules`
```bash
pnpm link --global
```
4. Enter project directory and create a config file named `cuc.config.js`
```js
// cuc.config.js
// example
module.exports = {
	entryPoints: [
		'src/app.tsx',
		'@/pages/notFound'
	],
	alias: {
		'@/': 'src/'
	}
}
```
5. Execute the command `check-useless-code` and then the console will output the results.
```bash
pnpm check-useless-code
```