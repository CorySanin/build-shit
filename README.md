# build-shit

[![GitHub License](https://img.shields.io/github/license/CorySanin/build-shit)](https://github.com/CorySanin/build-shit/blob/master/LICENSE)
[![NPM Version](https://img.shields.io/npm/v/forking-build-shit)](https://www.npmjs.com/package/forking-build-shit)
[![NPM Unpacked Size](https://img.shields.io/npm/unpacked-size/forking-build-shit)](https://www.npmjs.com/package/forking-build-shit)

A build script for preparing files for production. It handles CSS and JavaScript minification, Sass compilation, and image conversion to WebP and AVIF.

WebP conversion requires libwebp. AVIF conversion requires avifenc.

## Installation

```
npm install --save-dev forking-build-shit
```

## Usage

build-shit processes files from the following relative directories:

- `styles/` - Contains SCSS files
- `scripts/` - Contains JavaScript files
- `assets/images/original/` - Contains image files

After populating these directories, run the build script with `npx build-shit`.
