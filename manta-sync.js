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
var cuttlefish = require('cuttlefish');

var package = require('./package.json');

var errors = [];

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
    '    -- same as above, but just HEAD the data, don\'t PUT or DELETE',
    '',
    'options',
    '  -c, --concurrency <num>   max number of parallel HEAD\'s or PUT\'s to do, defaults to ' + opts.concurrency,
    '  -d, --delete              delete files on the remote end not found locally, defaults to ' + opts.delete,
    '  -h, --help                print this message and exit',
    '  -j, --just-delete         don\'t send local files to the remote end, just delete hanging remote files',
    '  -m, --md5                 use md5 instead of file size (slower, but more accurate)',
    '  -n, --dry-run             do everything except PUT any files',
    '  -u, --updates             check for available updates on npm',
    '  -v, --version             print the version number and exit'
  ].join('\n');
}

// command line arguments
var options = [
  'c:(concurrency)',
  'd(delete)',
  'h(help)',
  'j(just-delete)',
  'm(md5)',
  'n(dry-run)',
  'u(updates)',
  'v(version)'
].join('');
var parser = new getopt.BasicParser(options, process.argv);

var opts = {
  concurrency: 30,
  delete: false,
  dryrun: false,
  md5: false,
  justdelete: false,
};
var option;
while ((option = parser.getopt()) !== undefined) {
  switch (option.option) {
    case 'c': opts.concurrency = +option.optarg; break;
    case 'd': opts.delete = true; break;
    case 'h': console.log(usage()); process.exit(0);
    case 'j': opts.justdelete = true; break;
    case 'm': opts.md5 = true; break;
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
  console.error('[error] environmental variables MANTA_USER, MANTA_URL, and MANTA_KEY_ID must be set\n');
  console.error(usage());
  process.exit(1);
}
if (!process.env.SSH_AUTH_SOCK) {
  console.error('[error] currently, only ssh-agent authentication is supported\n');
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

var files = {}
var localFound = 0
finder.on('file', function(file, stat) {
  if (file.indexOf(localdir) !== 0)
    return console.error('error processing %s', file);

  var name = file.substr(localdir.length + 1)
  stat.name = name
  files[name] = stat
  localFound++
});

finder.on('end', function() {
  console.log('local file list built, %d files found\n', localFound);
  if (!localFound)
    return done();
  cuttle()
});

function md5file(file, cb) {
  var rs = fs.createReadStream(localdir + '/' + file.name)
  var md5sum = crypto.createHash('md5');
  var called = false
  rs.on('error', function(err) {
    var s = util.format('%s... read error: %s (%d/%d)',
        remotedir + '/' + file,
        err.message, localFound.length);
    console.error(s);
    errors.push(s);
    if (!called) {
      called = true
      cb(err)
    }
  });
  rs.on('data', md5sum.update.bind(md5sum));
  rs.on('end', function() {
    if (!called) {
      called = true
      cb(null, md5sum.digest('base64'))
    }
  });
}

function cuttle() {
  var syncStart = Date.now()

  var fish = cuttlefish({
    //timingDebug: true,
    // get md5s on demand, if opted in
    getMd5: opts.md5 ? md5file : null,
    files: files,
    path: remotedir,
    request: getFile,
    concurrency: opts.concurrency,
    client: client,
    delete: opts.delete,
    onlyDelete: opts.justdelete,
    dryRun: opts.dryrun
  });

  var deleted = 0;
  var sent = 0;
  var matched = 0;
  var errors = 0;

  fish.on('error', function(er) {
    errors++;
    console.error(er.stack);
    if (er.file)
      console.error('File: %s', er.file);
    if (er.remote)
      console.error('Remote: %s', er.remote);
    if (er.task)
      console.error('Task: %s', er.task);
  });

  fish.on('task', function(task) {
    if (task.file)
      console.log('%s %s...', task.name, task.file);
  });

  fish.on('file', function(file, status, remote) {
    console.log('%s %s', file, status)
  });

  fish.on('delete', function(file) {
    console.log('deleted %s', file)
    deleted++;
  });

  fish.on('match', function() {
    matched++;
  });

  fish.on('send', function() {
    sent++;
  });

  fish.on('complete', function(results) {
    console.log('done!');
    console.log('%d sent, %d matched, %d deleted, %d errors',
                sent, matched, deleted, errors);
    console.log('Synced completed in %d ms', Date.now() - syncStart);
    client.close();
    var ret = 0;
    client.close();
    process.exit(ret);
  });
}

function getFile(file, cb) {
  cb(null, fs.createReadStream(localdir + '/' + file));
}
