#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import child_process from 'child_process';
import uglifyjs from "uglify-js";
import * as sass from 'sass';
import * as csso from 'csso';

const spawn = child_process.spawn;
const fsp = fs.promises;
const STYLESDIR = 'styles';
const SCRIPTSDIR = 'scripts';
const IMAGESDIR = path.join(process.cwd(), 'assets', 'images', 'original');
const STYLEOUTDIR = process.env.STYLEOUTDIR || path.join('assets', 'css');
const SCRIPTSOUTDIR = process.env.SCRIPTSOUTDIR || path.join('assets', 'js');
const WEBPOUTDIR = process.env.IMAGESOUTDIR || path.join('assets', 'images', 'webp');
const AVIFOUTDIR = process.env.IMAGESOUTDIR || path.join('assets', 'images', 'avif');
const STYLEOUTFILE = process.env.STYLEOUTFILE || 'styles.css';
const SQUASH = new RegExp('^[0-9]+-');

async function emptyDir(dir: string) {
    await Promise.all((await fsp.readdir(dir, { withFileTypes: true })).map(f => path.join(dir, f.name)).map(p => fsp.rm(p, {
        recursive: true,
        force: true
    })));
    return true;
}

async function mkdir(dir: string | string[]) {
    if (typeof dir === 'string') {
        await fsp.mkdir(dir, { recursive: true });
    }
    else {
        await Promise.all(dir.map(mkdir));
    }
    return true;
}

function getFileExtension(filename: string) {
    const split = filename.split('.');
    return split[split.length - 1].toLowerCase();
}

// Process styles
async function styles() {
    await mkdir([STYLEOUTDIR, STYLESDIR]);
    await emptyDir(STYLEOUTDIR);
    const styles: string[] = [];
    const files = await fsp.readdir(STYLESDIR);
    await Promise.all(files.map(f => new Promise(async (res, reject) => {
        const p = path.join(STYLESDIR, f);
        console.log(`Processing style ${p}`);
        const style = sass.compile(p).css;
        if (f.charAt(0) !== '_') {
            if (SQUASH.test(f)) {
                styles.push(style);
            }
            else {
                const o = path.join(STYLEOUTDIR, f.substring(0, f.lastIndexOf('.')) + '.css');
                await fsp.writeFile(o, csso.minify(style).css);
                console.log(`Wrote ${o}`);
            }
        }
        res(0);
    })));
    const out = csso.minify(styles.join('\n')).css;
    const outpath = path.join(STYLEOUTDIR, STYLEOUTFILE);
    await fsp.writeFile(outpath, out);
    console.log(`Wrote ${outpath}`);
}

// Process scripts
async function scripts() {
    await mkdir([SCRIPTSOUTDIR, SCRIPTSDIR]);
    await emptyDir(SCRIPTSOUTDIR);
    const files = await fsp.readdir(SCRIPTSDIR);
    await Promise.all(files.map(f => new Promise(async (res, reject) => {
        const p = path.join(SCRIPTSDIR, f);
        const o = path.join(SCRIPTSOUTDIR, f);
        console.log(`Processing script ${p}`);
        try {
            await fsp.writeFile(o, uglifyjs.minify((await fsp.readFile(p)).toString()).code);
            console.log(`Wrote ${o}`);
        }
        catch (ex) {
            console.log(`error writing ${o}: ${ex}`);
        }
        res(0);
    })));
}

async function getAllFiles(fullDir: string): Promise<string[]> {
    if (!path.isAbsolute(fullDir)) {
        throw new Error('path must be absolute');
    }
    const files: string[] = [];
    const dirs = [''];
    for (let i = 0; i < dirs.length; i++) {
        const parent = dirs[i];
        const dir = path.join(fullDir, parent);
        const dirEnts = await fsp.readdir(dir, { withFileTypes: true });
        dirEnts.forEach(de => (de.isDirectory() ? dirs : files).push(path.join(parent, de.name)));
    }
    return files;
}

// Process images
async function images(webp: boolean, avif: boolean, dir: string = IMAGESDIR) {
    await mkdir(dir);
    await mkdir(WEBPOUTDIR) && await emptyDir(WEBPOUTDIR);
    await mkdir(AVIFOUTDIR) && await emptyDir(AVIFOUTDIR);
    const releativeFiles = await getAllFiles(dir);
    if (releativeFiles.length) {
        await Promise.all(releativeFiles.map(f => processImage(dir, f, webp, avif)));
    }
}

async function processImage(parentDir: string, relativeFile: string, webp: boolean, avif: boolean) {
    const infile = path.join(parentDir, relativeFile);
    const dir = path.dirname(relativeFile);
    const outDirWebP = path.join(WEBPOUTDIR, dir);
    const outDirAvif = path.join(AVIFOUTDIR, dir);
    webp && await mkdir(outDirWebP);
    avif && await mkdir(outDirAvif);
    console.log(`Processing image ${infile}`);
    webp && await convertWebP(infile, outDirWebP);
    avif && await convertAvif(infile, outDirAvif);
}

function convertWebP(infile: string, outDir: string) {
    return new Promise((resolve, reject) => {
        const filename = path.basename(infile);
        const extension = getFileExtension(filename);
        const outfile = path.join(outDir, filename.substring(0, filename.lastIndexOf('.')) + '.webp');
        const libwebpArgs = ['-mt'];
        if (extension === 'jpeg' || extension === 'jpg') {
            libwebpArgs.push('-q', '60');
        }
        else {
            libwebpArgs.push('-near_lossless', '55');
        }
        libwebpArgs.push(infile, '-o', outfile);
        const proc = spawn('cwebp', libwebpArgs);
        const timeout = setTimeout(() => {
            proc.kill();
            reject(new Error(`process timed out`));
        }, parseInt(process.env['CWEBPTIMEOUT']) || 30000);
        proc.on('exit', async (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                console.log(`Wrote ${outfile}`);
                resolve(true);
            }
            else {
                reject(new Error(`process ended with code ${code}`));
            }
        });
    });
}

function convertAvif(infile: string, outDir: string) {
    return new Promise((resolve, reject) => {
        const filename = path.basename(infile);
        const extension = getFileExtension(filename);
        const outfile = path.join(outDir, filename.substring(0, filename.lastIndexOf('.')) + '.avif');
        const avifencArgs = '--speed 6 --jobs all --depth 8 --cicp 1/13/6 --codec aom'.split(' ');
        if (extension === 'jpeg' || extension === 'jpg') {
            avifencArgs.push('--advanced', 'cq-level=28', '-q', '40', '--yuv', '420');
        }
        else {
            avifencArgs.push('--advanced', 'cq-level=30', '-q', '45', '--yuv', '444');
        }
        avifencArgs.push(infile, outfile);
        console.log(`avifenc ${avifencArgs.join(' ')}`);
        const proc = spawn('avifenc', avifencArgs);
        const timeout = setTimeout(() => {
            proc.kill();
            reject(new Error(`process timed out`));
        }, parseInt(process.env['AVIFENCTIMEOUT']) || 30000);
        proc.on('exit', async (code) => {
            clearTimeout(timeout);
            if (code === 0) {
                console.log(`Wrote ${outfile}`);
                resolve(true);
            }
            else {
                reject(new Error(`process ended with code ${code}`));
            }
        });
    });
}

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
    if (!webp && ! avif) {
        console.error('WARNING: no image encoding software found.');
    }
    await Promise.all([styles(), scripts(), images(webp, avif)]);
    if (process.argv.indexOf('--watch') >= 0) {
        console.log('watching for changes...');
        (async () => {
            try {
                const watcher = fsp.watch(STYLESDIR);
                for await (const _ of watcher)
                    await styles();
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
                    await scripts();
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
                    await images(webp, avif);
            } catch (err) {
                if (isAbortError(err))
                    return;
                throw err;
            }
        })();
    }
})();
