import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import uglifyjs from "uglify-js";
import * as sass from 'sass';
import * as csso from 'csso';

const SQUASH = new RegExp('^[0-9]+-');

export interface ImageProcessingOptions {
    webp: boolean;
    avif: boolean;
    webpOut: string;
    avifOut: string;
}

export interface BatchImageProcessingOptions extends ImageProcessingOptions {
    input: string;
}

type StyleFilesMapping = Record<string, string[]>;

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
    if (split.length <= 1) {
        return null;
    }
    return split[split.length - 1]?.toLowerCase();
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
        }, parseInt(process.env['CWEBPTIMEOUT'] || '30000'));
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
        }, parseInt(process.env['AVIFENCTIMEOUT'] || '30000'));
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

/**
 * Convert images to optimized webp and/or avif files
 * @param options options for processing images
 */
export async function images(options: BatchImageProcessingOptions) {
    await mkdir(options.input);
    await mkdir(options.webpOut) && await emptyDir(options.webpOut);
    await mkdir(options.avifOut) && await emptyDir(options.avifOut);
    const releativeFiles = await getAllFiles(options.input);
    if (releativeFiles.length) {
        await Promise.all(releativeFiles.map(f => processImage(options.input, f, options)));
    }
}

async function processImage(parentDir: string, relativeFile: string, options: ImageProcessingOptions) {
    const infile = path.join(parentDir, relativeFile);
    const dir = path.dirname(relativeFile);
    const outDirWebP = path.join(options.webpOut, dir);
    const outDirAvif = path.join(options.avifOut, dir);
    options.webp && await mkdir(outDirWebP);
    options.avif && await mkdir(outDirAvif);
    console.log(`Processing image ${infile}`);
    options.webp && await convertWebP(infile, outDirWebP);
    options.avif && await convertAvif(infile, outDirAvif);
}

/**
 * Process styles.
 * Sass is "compiled" and numbered files (^[0-9]+-) are combined into one.
 * Use subdirectories to group files that should be combined.
 * @param inputDir parent directory of styles
 * @param outputDir directory to put processed stylesheets
 * @param outputFile filename for combined styles that are a direct child of inputDir
 */
export async function styles(inputDir: string, outputDir: string, outputFile: string = 'styles') {
    await mkdir([outputDir, inputDir]);
    await emptyDir(outputDir);
    const map = await generateStyleGameplan(inputDir, outputFile);
    const promises: Promise<any>[] = [];
    for (let key in map) {
        const files = map[key]!;
        const squashable: string[] = [];
        const standalonable: string[] = [];
        files.forEach(f => {
            (SQUASH.test(path.basename(f)) ? squashable : standalonable).push(f);
        });
        if (squashable.length) {
            const squashed = path.join(outputDir, `${key}.css`);
            await mkdir(path.dirname(squashed));
            promises.push(style(squashable, squashed));
        }
        const standalonePromises = standalonable.map(async f => {
            const out = path.join(outputDir, `${f.substring(inputDir.length, f.lastIndexOf('.'))}.css`);
            await mkdir(path.dirname(out));
            await style([f], out);
        });
        promises.push(...standalonePromises);
    }
    await Promise.all(promises);
}

async function style(filenames: string[], output: string): Promise<void> {
    const styles: string[] = filenames.map(f => {
        console.log(`Processing style ${f}`);
        return sass.compile(f).css;
    });
    await fsp.writeFile(output, csso.minify(styles.join('\n')).css);
    console.log(`Wrote ${output}`);
}

/**
 * Minify JS files
 * @param inputDir directory containing js to be minified
 * @param outputDir directory to place minified js
 */
export async function scripts(inputDir: string, outputDir: string) {
    await mkdir([outputDir, inputDir]);
    await emptyDir(outputDir);
    const files = await fsp.readdir(inputDir);
    await Promise.all(files.filter(f => f.toLowerCase().endsWith('.js')).map(f => new Promise(async (res, _) => {
        const p = path.join(inputDir, f);
        const o = path.join(outputDir, f);
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

async function generateStyleGameplan(fullDir: string, rootName: string): Promise<StyleFilesMapping> {
    const map: StyleFilesMapping = {};
    (await getAllFiles(fullDir)).forEach(f => {
        if (path.basename(f).charAt(0) === '_') {
            return;
        }
        const dirname = path.dirname(f);
        (map[dirname === '.' ? rootName : dirname] ||= []).push(path.join(fullDir, f));
    });
    return map;
}

async function getAllFiles(dir: string): Promise<string[]> {
    const fullDir = path.resolve(dir);
    if (!path.isAbsolute(fullDir)) {
        throw new Error(`path must be absolute. got ${fullDir}`);
    }
    const files: string[] = [];
    const dirs = [''];
    for (let i = 0; i < dirs.length; i++) {
        const parent = dirs[i]!;
        const dir = path.join(fullDir, parent);
        const dirEnts = await fsp.readdir(dir, { withFileTypes: true });
        dirEnts.forEach(de => (de.isDirectory() ? dirs : files).push(path.join(parent, de.name)));
    }
    return files;
}
