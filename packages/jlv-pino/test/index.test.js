const { describe, it } = require('mocha');
const chai = require('chai');
const { Readable } = require('stream');

const transformer = require('../src/index');

chai.should();
describe('pino transformer', () => {
  it('check level 10', () => {
    let readable = Readable.from(['"level":10']);
    readable = transformer(readable);
    readable.on('data', (chunk) => {
      chunk.should.eq('"level":"trace"');
    });
  });

  it('check level 20', () => {
    let readable = Readable.from(['"level":20']);
    readable = transformer(readable);
    readable.on('data', (chunk) => {
      chunk.should.eq('"level":"debug"');
    });
  });

  it('check level 30', () => {
    let readable = Readable.from(['"level":30']);
    readable = transformer(readable);
    readable.on('data', (chunk) => {
      chunk.should.eq('"level":"info"');
    });
  });

  it('check level 40', () => {
    let readable = Readable.from(['"level":40']);
    readable = transformer(readable);
    readable.on('data', (chunk) => {
      chunk.should.eq('"level":"warn"');
    });
  });

  it('check level 50', () => {
    let readable = Readable.from(['"level":50']);
    readable = transformer(readable);
    readable.on('data', (chunk) => {
      chunk.should.eq('"level":"error"');
    });
  });

  it('check level 60', () => {
    let readable = Readable.from(['"level":60']);
    readable = transformer(readable);
    readable.on('data', (chunk) => {
      chunk.should.eq('"level":"fatal"');
    });
  });
});
