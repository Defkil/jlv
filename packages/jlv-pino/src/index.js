const es = require('event-stream');

/**
 * Replace pino log to be equal for json-log-viewer
 *
 * @param {Readable} stream Stream with pino log
 * @return {Readable} transformed stream
 */
module.exports = (stream) => stream
  .pipe(es.replace('"level":10', '"level":"trace"'))
  .pipe(es.replace('"level":20', '"level":"debug"'))
  .pipe(es.replace('"level":30', '"level":"info"'))
  .pipe(es.replace('"level":40', '"level":"warn"'))
  .pipe(es.replace('"level":50', '"level":"error"'))
  .pipe(es.replace('"level":60', '"level":"fatal"'))
  .pipe(es.replace('"level":60', '"level":"fatal"')); // todo: last one is ignored, but why?
// I dont know why its ignored, because of that it is double. Maybe someone can help
