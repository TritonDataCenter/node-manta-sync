#!/usr/bin/env node

var LocalFile = require('../lib/localfile');

var lf = new LocalFile(process.argv[2]);

go1();

function go1() {
  console.log('lf.info');
  lf.info(function(err, info) {
    if (err)
      throw err;
    console.log(info);
    go2();
  });
}

function go2() {
  console.log('lf.info with md5');
  lf.info({md5: true}, function(err, info) {
    if (err)
      throw err;
    console.log(info);
    go3();
  });
}

function go3() {
  console.log('lf.info createReadStream');
  var rs = lf.createReadStream();
  rs.on('error', function(err) {
    throw err;
  });
  rs.on('data', function(d) {
  });
  rs.on('end', function() {
    console.log('ended');
  });
}
