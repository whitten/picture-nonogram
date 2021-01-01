const fs = require('fs');
const im = require('imagemagick');

if (process.argv.length < 3) {
  console.log(`${process.argv[1]} requires an image file.`);
  process.exit(1);
}

const smallFilename = 'test-small.png';
const bwFilename = 'test-bw.png';
let imageFilename = process.argv[2];
let targetWidth = -1;
let targetHeight = -1;

im.identify(imageFilename, processFileInfo);

function processFileInfo(err, features) {
  if (err) {
    throw err;
  }

  // We now have the height and width, and now want to reduce it.
  // This assumes that the image is a usable size, though.  If the image
  // is square or has been manually cropped, the shrunken image is
  // going to either be too small (1x1) or too large (301x782) to work
  // with.
  const divisor = gcd(features.width, features.height);

  targetWidth = features.width / divisor;
  targetHeight = features.height / divisor;
  im.convert(
    [
      imageFilename,
      '-resize',
      `${targetWidth}x${targetHeight}`,
      smallFilename
    ],
    processSmallImage
  );
}

function processSmallImage(err, stdout) {
  if (err) {
    throw err;
  }

  // Now that we have a smaller image, convert it to black-and-white.
  im.convert(
    [
      smallFilename,
      '-negate',
      '-threshold',
      '66%',
      '-negate',
      bwFilename
    ],
    processBwImage
  );
}

function processBwImage(err, stdout) {
  if (err) {
    throw err;
  }

  fs.unlinkSync(smallFilename);
  // This dumps a test description of each pixel, its coordinates
  // and color.
  im.convert(
    [
      bwFilename,
      'txt:'
    ],
    processBits
  );
  console.log(stdout);
}

function processBits(err, stdout) {
  if (err) {
    throw err;
  }

  // Create a grid of the target size.
  const grid = Array.from(Array(targetHeight), () => new Array(targetWidth));
  // Hack up the text output for processing.
  const lines = stdout
    .split('\n')
    .map((l) => l.split(' '))
    .slice(1);
  const RleByRow = [];
  const RleByColumn = [];
  let row = 0;
  let column = 0;

  fs.unlinkSync(bwFilename);
  lines.forEach((l) => {
    if (l.length > 1) {
      // For the lines that are meaningful (not headers or empty),
      // plug the color into that location on a right-sized grid.
      const coord = l[0].slice(0, -1).split(',');
      const color = l[5].indexOf(0) < 0 ? 1 : 0;

      grid[Number(coord[1])][Number(coord[0])] = color;
    }
  });
  for (let i = 0; i < targetHeight; i++) {
    // For each row...
    RleByRow.push(encodeRun(grid[i]));
  }

  for (let j = 0; j < targetWidth; j++) {
    const column = grid.map((row) => row[j]);

    // For each column...
    RleByColumn.push(encodeRun(column));
  }

  stripRle(RleByRow, 0);
  stripRle(RleByColumn, 0);
}

function gcd(a, b) {
  // This is just a utility function to find the greatest common
  // denominator of two numbers.
  if (b === 0) {
    return a;
  }

  return gcd(b, a % b);
}

function stripRle(encoding, valueToKeep) {
  const height = encoding.length;

  for (i = 0; i < height; i++) {
    const newRow = encoding[i]
      .filter((tuple) => tuple[0] === valueToKeep)
      .map((tuple) => tuple[1]);

    encoding[i] = newRow;
  }
}

function encodeRun(bits) {
  const encoding = [];
  let currentTotal = 0;
  let currentColor = 0;
  let count = 0;

  while (count < bits.length) {
    // Count the consecutive cells for each color.
    // This is, essentially, run-length encoding.
    if (currentColor !== bits[count]) {
      // Reset when the color changes.
      encoding.push([currentColor, currentTotal]);
      currentColor = bits[count];
      currentTotal = 0;
    }

    count += 1;
    currentTotal += 1;
  }

  encoding.push([currentColor, currentTotal]);
  return encoding;
}

