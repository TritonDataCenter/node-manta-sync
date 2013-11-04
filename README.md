manta-sync
==========

Rsync style command for [Joyent's Manta](http://www.joyent.com/products/manta)

Installation
------------

    npm install -g manta-sync

Usage
-----

    manta-sync ./ ~~/stor/foo

`manta-sync` requires 2 arguments, the first is a local directory that you
would like to sync *the contents* of into manta.  The second is
a manta directory that you would like the files to by synced to.

All remote directories will be lazily created for you if they do not exist,
relying on the latest `manta` node module for this behavior.

`manta-sync` has slightly different usage than the standard node manta
tools, it requires `MANTA_USER`, `MANTA_URL` and `MANTA_KEY_ID` be set.

    usage: manta-sync [options] localdir ~~/remotedir

    synchronize all files found inside `localdir` to `~~/remotedir`

    examples
      manta-sync ./ ~~/stor/foo
        -- sync all files in your cwd to the dir ~~/stor/foo
      manta-sync --dry-run ./ ~~/stor/foo
        -- same as above, but just HEAD the data, don't PUT

    options
      -c, --concurrency <num>   max number of parallel HEAD's or PUT's to do, defaults to 30
      -d, --delete              delete files on the remote end not found locally, defaults to false
      -h, --help                print this message and exit
      -j, --just-delete         don't send local files to the remote end, just delete hanging remote files
      -m, --md5                 use md5 instead of file size (slower, but more accurate)
      -n, --dry-run             do everything except PUT any files
      -u, --updates             check for available updates on npm
      -v, --version             print the version number and exit

Example
-------

First we'll create a basic directory structure we want to sync to manta

    $ mkdir foo
    $ touch foo/a foo/b foo/c
    $ mkdir foo/d
    $ touch foo/d/e
    $ ls foo/
    a  b  c  d/
    $ ls foo/d
    e

Now, let's look at the remote end to see what we're dealing with

    $ mls ~~/stor
    $

Nothing on the remote end yet, let's sync the files up

    $ manta-sync foo/ ~~/stor/foo
    building local file list...
    local file list built, 4 files found

    ~~/stor/foo/d/e... not found, adding to put list (1/4)
    ~~/stor/foo/c... not found, adding to put list (2/4)
    ~~/stor/foo/b... not found, adding to put list (3/4)
    ~~/stor/foo/a... not found, adding to put list (4/4)

    upload list built, 4 files staged for uploading

    ~~/stor/foo/a... uploaded (1/4)
    ~~/stor/foo/b... uploaded (2/4)
    ~~/stor/foo/c... uploaded (3/4)
    ~~/stor/foo/d/e... uploaded (4/4)

    4 files put successfully, 0 files failed to put

    done

All 4 files were uploaded (and their directories created), we can verify this with

    $ mls ~~/stor
    foo/
    $ mls ~~/stor/foo
    a
    b
    c
    d/
    $ mls ~~/stor/foo/d
    e

Now that we are synced up, let's run it again and see what happens

    $ manta-sync foo/ ~~/stor/foo
    building local file list...
    local file list built, 4 files found

    ~~/stor/foo/b... size same as local file, skipping (1/4)
    ~~/stor/foo/d/e... size same as local file, skipping (2/4)
    ~~/stor/foo/c... size same as local file, skipping (3/4)
    ~~/stor/foo/a... size same as local file, skipping (4/4)

    upload list built, 0 files staged for uploading


    done

This time the output is slightly different, because the files were
found on the remote end and the have the same size as the local files.

So let's modify a file and rerun the sync

    $ echo hello > foo/a
    $ manta-sync foo/ ~~/stor/foo
    building local file list...
    local file list built, 4 files found

    ~~/stor/foo/c... size same as local file, skipping (1/4)
    ~~/stor/foo/a... size is different, adding to put list (2/4)
    ~~/stor/foo/d/e... size same as local file, skipping (3/4)
    ~~/stor/foo/b... size same as local file, skipping (4/4)

    upload list built, 1 files staged for uploading

    ~~/stor/foo/a... uploaded (1/1)

    1 files put successfully, 0 files failed to put

    done

`manta-sync` detected one of the files on the local end was a different
size than reported by manta, so it staged it for uploading, and `PUT`
the file.

How
---

`manta-sync` works in 4 (optionally 5) stages

### 1. Find all local files

The node module [findit](https://github.com/substack/node-findit) is used to
locate (and `stat(2)`) all local files, to build a list of files that need
to be synced.

### 2. Process each local file, figure out if we need to put a new version into Manta

For each local file found, a corresponding remote manta filename is constructed, and
then checked for info (`HEAD` request) to see if it exists, and what its size is if
it is found.

If the file is not found (`404` / `NotFoundError`) it is staged for uploading.

If the file is found, and the size reported by manta is different than the size
on the filesystem, it is also staged for uploading.  This behavior can be
modified with the `-m` or `--md5` switch, which tells `manta-sync` to use the md5 hash
of a file instead of the file size.

### 3. Upload each file that needs to be uploaded, lazily handling directory creation

For each file that has been staged for uploading, a `PUT` request is made, and
all directories that are needed are created lazily (which may result in more than
1 `PUT` per file).

If `-n` or `--dry-run` is supplied, this step is skipped  by just printing
what actions would have been taken.  Note that during a dry-run, `HEAD` requests
are still made.

### 4. (optional) Delete files found on the remote end not found locally

If `--delete` is supplied, a walk of the remote file tree is done and compared
against the list of local files from step 1.  Every file found on the remote
end that is not referenced locally is deleted.

### 5. Print statistics, clean up

`manta-sync` prints how many files were uploaded, and how many (if any) files failed
to upload.  Also, any errors that were encountered are displayed again at the bottom of
the output.

Possible Future Features
------------------------

- Remote => Local sync
- identify files on the remote end not found on the local end (and unlink them)
- count number of `HEAD` and `PUT` requests done (for billing purposes)

License
-------

MIT
