var manta = require('manta');

var mfind = require('../lib/mfind.js');

var client = manta.createClient({
  sign: manta.sshAgentSigner({
    keyId: process.env.MANTA_KEY_ID,
    user: process.env.MANTA_USER
  }),
  user: process.env.MANTA_USER,
  url: process.env.MANTA_URL
});

mfind(client, process.argv[2] || '~~/stor/foo', function(err, files) {
  if (err) throw err;
  console.log(files);
  client.close();
});
