const { Command } = require('commander');
const {
  createLogFile,
  saveLogFile,
  run,
  backupConfig,
  resetConfig,
  loadConfig,
  runTransformerPath,
  runTransformerNpm,
} = require('./jlv.js');

/** @module cli */

const program = new Command();
program
  .option('-p, --param <type>', 'json-log-viewer parameter')
  .option('-f, --files <type>', 'log files to view')
  .option('-c, --config <type>', 'path to .json-log-viewer config file')
  .option('-r, --reset', 'reset .json-log-viewer in HOME folder')
  .option('-t, --transformer <type>', 'load transformer from a npm module')
  .option('-tjs, --transformer-js <type>', 'load transformer from a javascript file')
  .option('-o, --open', 'open json-log-viewer in a new shell')
  .option('-s, --save <type>', 'save merged log file')
  .option('-b, --backup <type>', 'backup .json-log-viewer to given path');
program.parse(process.argv);

/**
 * Run JLV from CLI
 *
 * @param {!object} input jlv parameter
 * @param {string=} input.param json-log-viewer parameter
 * @param {!string} input.files log files to view
 * @param {string=} input.config path to .json-log-viewer config file
 * @param {boolean=} input.reset reset .json-log-viewer in HOME folder if true
 * @param {string=} input.transformer load transformer from a npm module
 * @param {string=} input.transformerJs load transformer from a javascript file
 * @param {boolean=} input.open open json-log-viewer in a new shell
 * @param {string=} input.save save merged log file
 * @param {string=} input.backup backup .json-log-viewer to given path
 */
async function cli(input) {
  if (input.backup) await backupConfig(input.backup);
  if (input.reset) await resetConfig();

  if (input.files) {
    let filePath = await createLogFile(input.files); // todo save after transforming
    if (input.transformer) filePath = await runTransformerNpm(input.transformer, filePath);
    if (input.transformerJs) filePath = await runTransformerPath(input.transformerJs, filePath);
    if (input.save) await saveLogFile(filePath, input.save);
    await loadConfig(input.config);
    await run(filePath, input.param, input.open);
  } else {
    // eslint-disable-next-line no-console
    console.log('No files selected');
  }
}

cli(program.opts()).then(() => {}).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
