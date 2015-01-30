#!/usr/bin/env node

var LocalFile = require('../lib/localfile');

var lf = new LocalFile(process.argv[2]);

go1();

function go1() {
  console.log('lf.ftw');
  lf.ftw(function(err, ee) {
    if (err)
      throw err;
    ee.on('file', function(_lf) {
      console.log(_lf.toString());
    });
    ee.on('end', function() {
      console.log('done');
    });
  });
}
