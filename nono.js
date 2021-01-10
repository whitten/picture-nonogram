const fs = require('fs');
const im = require('imagemagick');
const superagent = require('superagent');

const minimumSize = 15;
const minColor = 0.35;
const maxColor = 0.75;
let defaultPercentBlack = 66;


const smallFilename = 'test-small.png';
const bwFilename = 'test-bw.png';
let imageFilename = process.argv[2];
let targetWidth = -1;
let targetHeight = -1;

if (process.argv.length < 3) {
} else {
  processExistingImage(process.argv[2]);
}

function processExistingImage(filename) {
  im.identify(filename, processFileInfo);
}

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

  if (targetWidth > minimumSize && targetHeight > minimumSize) {
    const newRatio = simplifyAspectRatio(targetWidth / targetHeight, 50);

    targetWidth = newRatio[0];
    targetHeight = newRatio[1];
  }

  if (targetWidth < minimumSize || targetHeight < minimumSize) {
    let aspect = {
      height:  targetHeight,
      width:  targetWidth,
    };
    const smaller = targetWidth < targetHeight ? "width" : "height";
    const larger = targetWidth < targetHeight ? "height" : "width";
    const ratio = minimumSize / aspect[smaller];

    aspect[smaller] = minimumSize;
    aspect[larger] = Math.trunc(aspect[larger] * ratio + 0.5);
    targetHeight = aspect.height;
    targetWidth = aspect.width;
  }

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

function processSmallImage(err, stdout, percentage) {
  if (err) {
    throw err;
  }

  if (percentage === '') {
    percentage = defaultPercentBlack;
  }

  // Now that we have a smaller image, convert it to black-and-white.
  im.convert(
    [
      smallFilename,
      '-negate',
      '-threshold',
      `${percentage}%`,
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

  // This dumps a test description of each pixel, its coordinates
  // and color.
  im.convert(
    [
      bwFilename,
      'txt:'
    ],
    processBits
  );
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

  const onBits = RleByRow
    .map((row) => row.reduce((a, b) => a + b, 0))
    .reduce((a, b) => a + b)
    / (targetWidth * targetHeight);

  if (onBits > maxColor) {
    defaultPercentBlack += 1;
    processSmallImage(null, null, defaultPercentBlack);
    return;
  } else if (onBits < minColor) {
    defaultPercentBlack -= 1;
    processSmallImage(null, null, defaultPercentBlack);
    return;
  }

  fs.unlinkSync(smallFilename);
  fs.unlinkSync(bwFilename);
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

    while (newRow[0] === 0) {
      newRow.shift();
    }

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

function simplifyAspectRatio(val, lim) {
  // This code comes from https://stackoverflow.com/a/43016456/3438854
  // by ccpizza (https://stackoverflow.com/users/191246/ccpizza),
  // licensed CC-BY-SA 3.0
  var lower = [0, 1];
  var upper = [1, 0];

  while (true) {
    var mediant = [lower[0] + upper[0], lower[1] + upper[1]];

    if (val * mediant[1] > mediant[0]) {
      if (lim < mediant[1]) {
        return upper;
      }
      lower = mediant;
    } else if (val * mediant[1] == mediant[0]) {
      if (lim >= mediant[1]) {
        return mediant;
      }
      if (lower[1] < upper[1]) {
        return lower;
      }
      return upper;
    } else {
      if (lim < mediant[1]) {
        return lower;
      }
      upper = mediant;
    }
  }
}

