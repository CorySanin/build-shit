# build-shit
A build script for preparing files for production. It handles CSS and JavaScript minification, Sass compilation, and image conversion to WebP.

WebP conversion requires libwebp.

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
