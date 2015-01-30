#!/usr/bin/env node

var manta = require('manta');

var MantaFile = require('../lib/mantafile');

var client = manta.createClient({
  sign: manta.sshAgentSigner({
    keyId: process.env.MANTA_KEY_ID,
    user: process.env.MANTA_USER
  }),
  user: process.env.MANTA_USER,
  url: process.env.MANTA_URL
});

var mf = new MantaFile(process.argv[2], client);

go1();

function go1() {
  console.log('mf.info');
  mf.info(function(err, info) {
    if (err)
      throw err;
    console.log(info);
    go2();
  });
}

function go2() {
  console.log('mf.info with md5');
  mf.info({md5: true}, function(err, info) {
    if (err)
      throw err;
    console.log(info);
    go3();
  });
}

function go3() {
  console.log('mf.info createReadStream');
  var rs = mf.createReadStream();
  rs.on('error', function(err) {
    throw err;
  });
  rs.on('data', function(d) {
  });
  rs.on('end', function() {
    console.log('ended');
    client.close();
  });
}
