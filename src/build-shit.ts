#!/usr/bin/env node

import path from 'path';
import fsp from 'fs/promises';
import { spawn } from 'child_process';
import * as bs from './index.js';

const STYLESDIR = 'styles';
const SCRIPTSDIR = 'scripts';
const IMAGESDIR = path.join(process.cwd(), 'assets', 'images', 'original');
const STYLEOUTDIR = process.env['STYLEOUTDIR'] || path.join('assets', 'css');
const SCRIPTSOUTDIR = process.env['SCRIPTSOUTDIR'] || path.join('assets', 'js');
const WEBPOUTDIR = process.env['IMAGESOUTDIR'] || path.join('assets', 'images', 'webp');
const AVIFOUTDIR = process.env['IMAGESOUTDIR'] || path.join('assets', 'images', 'avif');
const STYLEOUTFILE = process.env['STYLEOUTFILE'] || 'styles.css';

function commandExists(cmd: string): Promise<boolean> {
    return new Promise((resolve, _) => {
        const proc = spawn('which', cmd.split(' '));
        proc.on('exit', async (code) => resolve(code === 0));
    });
}

function isAbortError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError';
}

(async function () {
    const webp = await commandExists('cwebp');
    const avif = await commandExists('avifenc');

    const doStyles = () => {
        return bs.styles(STYLESDIR, STYLEOUTDIR, STYLEOUTFILE);
    }

    const doScripts = () => {
        return bs.scripts(SCRIPTSDIR, SCRIPTSOUTDIR);
    }

    const doImages = () => {
        return bs.images({
            webp,
            avif,
            input: IMAGESDIR,
            webpOut: WEBPOUTDIR,
            avifOut: AVIFOUTDIR
        });
    }

    if (!webp && !avif) {
        console.error('WARNING: no image encoding software found.');
    }
    await Promise.all([doStyles(), doScripts(), doImages()]);
    if (process.argv.indexOf('--watch') >= 0) {
        console.log('watching for changes...');
        (async () => {
            try {
                const watcher = fsp.watch(STYLESDIR);
                for await (const _ of watcher)
                    await doStyles();
            } catch (err) {
                if (isAbortError(err))
                    return;
                throw err;
            }
        })();

        (async () => {
            try {
                const watcher = fsp.watch(SCRIPTSDIR);
                for await (const _ of watcher)
                    await doScripts();
            } catch (err) {
                if (isAbortError(err))
                    return;
                throw err;
            }
        })();

        (async () => {
            try {
                const watcher = fsp.watch(IMAGESDIR, {
                    recursive: true // no Linux ☹️
                });
                for await (const _ of watcher)
                    await doImages();
            } catch (err) {
                if (isAbortError(err))
                    return;
                throw err;
            }
        })();
    }
})();