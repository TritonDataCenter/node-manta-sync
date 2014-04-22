/**
 * basic recursive file walker
 *
 * like the node module `findit`, but doesn't
 * give special treatment to symlinks
 */
var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var path = require('path');
var util = require('util');

module.exports = Finder;

util.inherits(Finder, EventEmitter);
function Finder(basedir) {
  var self = this;
  EventEmitter.call(self);

  var pending = 0;
  walk('./');
  function walk(dir) {
    pending++;
    var absolutedir = path.join(basedir, dir);
    fs.readdir(absolutedir, function(err, rdir) {
      pending--;
      if (err || !rdir.length)
        return check();
      rdir.forEach(function(f) {
        pending++;
        var relativepath = path.join(dir, f);
        var fullpath = path.join(basedir, relativepath);
        fs.stat(fullpath, function(_err, stat) {
          pending--;
          if (stat && stat.isDirectory()) {
            self.emit('directory', fullpath, stat);
            walk(relativepath);
          } else if (stat && stat.isFile()) {
            self.emit('file', fullpath, stat);
          }
          check();
        });
      });
    });
  }
  function check() {
    if (pending === 0)
      self.emit('end');
  }
}

if (require.main === module) {
  var finder = new Finder(process.argv[2] || __dirname);
  finder.on('file', function(file, stats) {
    console.log('%s = %d bytes', file, stats.size);
  });

  finder.on('directory', function(directory, stats) {
    console.log('%s/', directory);
  });

  finder.on('end', function() {
    console.log('done');
  });
}
