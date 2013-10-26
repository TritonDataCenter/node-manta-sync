#!/usr/bin/env node
/**
 * Rsync style command for Joyent's Manta
 *
 * Author: Dave Eddy <dave@daveeddy.com>
 * Date: 10/24/13
 * License: MIT
 */

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var util = require('util');

var async = require('async');
var findit = require('findit');
var getopt = require('posix-getopt');
var manta = require('manta');

// XXX https://github.com/joyent/node-manta/issues/139
var EMPTY_MD5 = 'd41d8cd98f00b204e9800998ecf8427e';

var package = require('./package.json');

function usage() {
  return [
    'usage: manta-sync [options] localdir ~~/remotedir',
    '',
    'synchronize all files found inside `localdir` to `~~/remotedir`',
    '',
    'examples',
    '  manta-sync ./ ~~/stor/foo',
    '    -- sync all files in your cwd to the dir ~~/stor/foo',
    '  manta-sync --dry-run ./ ~~/stor/foo',
    '    -- same as above, but just HEAD the data, don\'t PUT',
    '',
    'options',
    '  -c, --concurrency <num>   max number of parallel HEAD\'s or PUT\'s to do, defaults to ' + opts.concurrency,
    '  -h, --help                print this message and exit',
    '  -m, --md5                 use md5 instead of file size (slower, but more accurate)',
    '  -n, --dry-run             do everything except PUT any files',
    '  -u, --updates             check for available updates on npm',
    '  -v, --version             print the version number and exit'
  ].join('\n');
}

// command line arguments
var options = [
  'c:(concurrency)',
  'h(help)',
  'm(md5)',
  'n(dry-run)',
  'u(updates)',
  'v(version)'
].join('');
var parser = new getopt.BasicParser(options, process.argv);

var opts = {
  concurrency: 30,
  dryrun: false,
  md5: false
};
var option;
while ((option = parser.getopt()) !== undefined) {
  switch (option.option) {
    case 'c': opts.concurrency = +option.optarg; break;
    case 'm': opts.md5 = true; break;
    case 'h': console.log(usage()); process.exit(0);
    case 'n': opts.dryrun = true; break;
    case 'u': // check for updates
      require('latest').checkupdate(package, function(ret, msg) {
        console.log(msg);
        process.exit(ret);
      });
      return;
    case 'v': console.log(package.version); process.exit(0);
    default: console.error(usage()); process.exit(1); break;
  }
}
var args = process.argv.slice(parser.optind());

if (args.length !== 2) {
  console.error('[error] must supply exactly 2 operands\n');
  console.error(usage());
  process.exit(1);
}
if (!process.env.MANTA_KEY_ID ||
    !process.env.MANTA_USER   ||
    !process.env.MANTA_URL) {
  console.error('environmental variables MANTA_USER, MANTA_URL, and MANTA_KEY_ID must be set');
  console.error(usage());
  process.exit(1);
}

var localdir = path.resolve(args[0]);
var remotedir = args[1];

var client = manta.createClient({
  sign: manta.sshAgentSigner({
    keyId: process.env.MANTA_KEY_ID,
    user: process.env.MANTA_USER
  }),
  user: process.env.MANTA_USER,
  url: process.env.MANTA_URL
});

var finder = findit(localdir);

// 1. Find all local files
if (opts.dryrun)
  console.log('== dryrun ==');
console.log('building local file list...');
var localfiles = [];
var infoqueue = async.queue(processfile, opts.concurrency);
finder.on('file', function(file, stat) {
  if (file.indexOf(localdir) !== 0)
    return console.error('error processing %s', file);

  localfiles.push({file: file, stat: stat});
});

finder.on('end', function() {
  console.log('local file list built, %d files found\n', localfiles.length);
  if (!localfiles.length)
    return done();
  infoqueue.push(localfiles, function() {});
});

// 2. Process each local file, figure out if we need to put
// a new version into Manta
var processed = 0;
var filestoput = [];
var errors = [];
var putqueue = async.queue(putfile, opts.concurrency);
function processfile(d, cb) {
  /**
   * $ manta-sync ./foo ~~/stor/foo
   * d.file = /home/dave/foo/file.txt (absolute path)
   * d.stat = [Stat object]
   * d.basefile = file.txt
   * d.mantafile = ~~/store/foo/file.txt
   */

  d.basefile = d.file.substr(localdir.length);
  d.mantafile = path.join(remotedir, d.basefile);

  client.info(d.mantafile, function(err, info) {
    if (err) {
      processed++;
      if (err.code === 'NotFoundError') {
        console.log('%s... not found, adding to put list (%d/%d)',
            d.mantafile, processed, localfiles.length);
        filestoput.push(d);
      } else {
        var s = util.format('%s... unknown error: %s (%d/%d)',
            d.mantafile, err.code, processed, localfiles.length);
        console.error(s);
        errors.push(s);
      }
      cb();
      return;
    }

    if (opts.md5) {
      // md5
      var md5sum = crypto.createHash('md5');
      var rs = fs.createReadStream(d.file);
      rs.on('error', function(err) {
        processed++;
        var s = util.format('%s... read error: %s (%d/%d)',
            d.mantafile, err.message, processed, localfiles.length);
        console.error(s);
        errors.push(s);
      });

      rs.on('data', md5sum.update.bind(md5sum));
      rs.on('end', function() {
        processed++;
        var md5 = md5sum.digest('hex');

        var remotemd5 = info.md5;
        if (!remotemd5) {
          remotemd5 = EMPTY_MD5;
        } else {
          remotemd5 = new Buffer(remotemd5, 'base64').toString('hex');
        }

        if (md5 === remotemd5) {
          console.log('%s... md5 same as local file, skipping (%d/%d)',
            d.mantafile, processed, localfiles.length);
        } else {
          console.log('%s... md5 is different, adding to put list (%d/%d)',
            d.mantafile, processed, localfiles.length);
          filestoput.push(d);
        }

        cb();
      });
      return;
    } else {
      processed++;
      // XXX +info.size is a hack
      // https//github.com/joyent/node-manta/issues/136
      if (d.stat.size === +info.size) {
        console.log('%s... size same as local file, skipping (%d/%d)',
            d.mantafile, processed, localfiles.length);
      } else {
        console.log('%s... size is different, adding to put list (%d/%d)',
            d.mantafile, processed, localfiles.length);
        filestoput.push(d);
      }
      cb();
      return;
    }
  });
}

var putsstarted;
infoqueue.drain = function() {
  processed = 0;
  console.log('\nupload list built, %d files staged for uploading\n',
      filestoput.length);
  if (!filestoput.length)
    return done();
  putqueue.push(filestoput, function() {});
  putsstarted = Date.now();
};

// 3. Upload each file that needs to be uploaded, lazily handling
// directory creation
var filesput = 0;
var filesnotput = 0;
function putfile(d, cb) {
  if (opts.dryrun) {
    console.log('%s... uploaded (dryrun)', d.mantafile);
    return cb();
  }
  var rs = fs.createReadStream(d.file);
  rs.on('error', function(err) {
    processed++;
    var s = util.format('%s... error opening file: %s (%d/%d)',
      d.mantafile, err.message, processed, filestoput.length);
    console.error(s);
    errors.push(s);
    filesnotput++;
    cb();
  });

  rs.on('open', function(fd) {
    client.put(d.mantafile, rs, {size: d.stat.size, mkdirs: true}, function(err) {
      processed++;
      if (err) {
        var s = util.format('%s... error uploading: %s (%d/%d)',
          d.mantafile, err.code, processed, filestoput.length);
        console.error(s);
        errors.push(s);
        filesnotput++;
      } else {
        console.log('%s... uploaded (%d/%d)',
          d.mantafile, processed, filestoput.length);
        filesput++;
      }
      cb();
    });
  });
}

putqueue.drain = function() {
  console.log('\n%d files put successfully, %d files failed to put',
      filesput, filesnotput);
  done();
};

// 4. Done
function done() {
  var ret = 0;
  if (errors.length) {
    ret = 1;
    console.error('\n== errors\n');
    errors.forEach(function(error) {
      console.error(error);
    });
  }
  console.log('\ndone.  puts took %d ms', (Date.now() - putsstarted) || 0);
  client.close();
  process.exit(ret);
}
