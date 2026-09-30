// Compile in a child process so an unsupported or slow compiler cannot block report generation.
const fs = require('node:fs');
const wrapper = require('solc/wrapper');
const compiler = wrapper(require(process.argv[2]));
if (compiler.version().split('.Emscripten')[0] !== process.argv[3]) process.exit(1);
const output = JSON.parse(compiler.compile(fs.readFileSync(0, 'utf8')));
if (output.errors?.some((error) => error.severity === 'error')) process.exit(1);
process.stdout.write(JSON.stringify(output.contracts));
