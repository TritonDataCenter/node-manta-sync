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
var manta = require('manta');
var cuttlefish = require('cuttlefish');
var createClient = require('manta-client');
var dashdash = require('dashdash');

var parser = dashdash.createParser({
  options: manta.DEFAULT_CLI_OPTIONS.concat([
    { names: [ 'concurrency', 'c' ],
      type: 'number',
      helpArg: 'NUM',
      default: 30,
      help: 'Max number of parallel actions' },
    { names: [ 'delete', 'd' ],
      type: 'bool',
      default: false,
      help: 'Delete extra files found on remote end' },
    { names: [ 'just-delete', 'j' ],
      type: 'bool',
      default: false,
      help: 'Only delete, do not send any files' },
    { names: [ 'md5', 'm' ],
      type: 'bool',
      default: false,
      help: 'Compare md5 checksums' },
    { names: [ 'dry-run', 'n' ],
      type: 'bool',
      default: false,
      help: 'Perform no remote write operations' },
    { names: [ 'updates' ],
      type: 'bool',
      default: false,
      help: 'Check for available updates on npm' },
    { names: [ 'version' ],
      type: 'bool',
      default: false,
      help: 'Print the version number and exit' }
  ])
});


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
    parser.help()
  ].join('\n');
}

var opts = parser.parse({ argv: process.argv, env: process.env });

if (opts.help)
  return console.log(usage());

var args = opts._args

if (args.length !== 2) {
  console.error('[error] must supply exactly 2 operands\n');
  console.error(usage());
  process.exit(1);
}
var localdir = args[0];
var remotedir = args[1];

var client = createClient(process.argv, process.env);

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
