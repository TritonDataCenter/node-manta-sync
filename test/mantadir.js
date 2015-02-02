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
  console.log('mf.ftw');
  mf.ftw(function(err, ee) {
    if (err)
      throw err;
    ee.on('file', function(_mf) {
      console.log(_mf.toString());
    });
    ee.on('end', function() {
      console.log('done');
      client.close();
    });
  });
}
