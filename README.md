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

If you supply `-r`, `manta-sync` will work in reverse, pulling files from
manta onto your local filesystem.

    manta-sync -r ~~/stor/foo ./foo

Usage
-----

    $ manta-sync -h
    usage: manta-sync [OPTIONS] localdir ~~/remotedir

    synchronize all files found inside `localdir` to `~~/remotedir`

    examples

      manta-sync ./ ~~/stor/foo
        - sync all files in your cwd to the dir ~~/stor/foo

      manta-sync --dry-run ./ ~~/stor/foo
        - same as above, but just HEAD the data, don't PUT

      manta-sync -r ~~/stor/foo ./bar
        - sync all files from manta in ~~/stor/foo to the local dir ./bar

    options:
        -h, --help                          Print this help and exit.
        --version                           Print version and exit.
        -v, --verbose                       Verbose trace logging.

      Manta connection options:
        -a ACCOUNT, --account=ACCOUNT       Manta Account (login name). Environment:
                                            MANTA_USER=ACCOUNT
        --user=USER, --subuser=USER         Manta User (login name). Environment:
                                            MANTA_SUBUSER=USER
        --role=ROLE,ROLE,...                Assume a role. Use multiple times or
                                            once with a list. Environment:
                                            MANTA_ROLE=ROLE,ROLE,...
        -i, --insecure                      Do not validate SSL certificate.
                                            Environment: MANTA_TLS_INSECURE=1
        -k FP, --keyId=FP                   SSH key fingerprint. Environment:
                                            MANTA_KEY_ID=FP
        -u URL, --url=URL                   Manta URL. Environment: MANTA_URL=URL
        -c COPIES, --copies=COPIES          number of copies to make.
        -d, --delete                        delete files on the remote end not found
                                            locally.
        -x ARG, --exclude=ARG               a pattern to ignore when searching the
                                            local filesystem.
        -H HEADER, --header=HEADER          HTTP headers to include.
        -j, --just-delete                   don't send local files, just delete
                                            extra remote files.
        -l, --ignore-links                  ignore symlinks.
        -m, --md5                           use md5 instead of file size (slower,
                                            but more accurate).
        -n, --dry-run                       don't perform any remote PUT or DELETE
                                            operations.
        -p CONCURRENCY, --parallel=CONCURRENCY
                                            limit concurrent operations.
        -q, --quiet                         suppress all output.
        -r, --reverse                       manta to local sync.
        -U, --updates                       check for available updates on npm.

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
    ~~/stor/foo/a... not found, adding to put list (2/4)
    ~~/stor/foo/c... not found, adding to put list (3/4)
    ~~/stor/foo/b... not found, adding to put list (4/4)

    upload list built, 4 files staged for uploading (took 1016ms)

    ~~/stor/foo/a... uploaded (1/4)
    ~~/stor/foo/b... uploaded (2/4)
    ~~/stor/foo/c... uploaded (3/4)
    ~~/stor/foo/d/e... uploaded (4/4)

    4 files (0 bytes) put successfully, 0 files failed to put (took 474ms)

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

    ~~/stor/foo/a... size same as local file, skipping (1/4)
    ~~/stor/foo/b... size same as local file, skipping (2/4)
    ~~/stor/foo/c... size same as local file, skipping (3/4)
    ~~/stor/foo/d/e... size same as local file, skipping (4/4)

    upload list built, 0 files staged for uploading (took 838ms)


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

    upload list built, 1 files staged for uploading (took 999ms)

    ~~/stor/foo/a... uploaded (1/1)

    1 files (6 bytes) put successfully, 0 files failed to put (took 152ms)

    done

`manta-sync` detected one of the files on the local end was a different
size than reported by manta, so it staged it for uploading, and `PUT`
the file.

How
---

`manta-sync` works in 4 (optionally 5) stages

### 1. Find all local files

The local module [Finder](/lib/finder.js) is used to
locate (and `stat(2)`) all local files, to build a list of files that need
to be synced.

If `-x` or `--exclude` arguments are supplied, they will be used in this step
to filter out the local files found.  For instance, `--exclude ./.git/` will
cause `manta-sync` to skip all files beginning with `.git/`.

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

Any files skipped (by `--exclude`) in the first step **will** be deleted
from the remote end if they are found.

### 5. Print statistics, clean up

`manta-sync` prints how many files were uploaded, and how many (if any) files failed
to upload.  Also, any errors that were encountered are displayed again at the bottom of
the output.

Possible Future Features
------------------------

- count number of `HEAD` and `PUT` requests done (for billing purposes)

License
-------

MIT
