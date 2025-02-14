const fs = require('fs');
const im = require('imagemagick');
const superagent = require('superagent');

const minimumSize = 15;
const minColor = 0.35;
const maxColor = 0.75;
let defaultPercentBlack = 66;

const smallFilename = 'test-small.png';
const bwFilename = 'test-bw.png';
let imageFilename = 'downloaded-image.jpg';
let targetWidth = -1;
let targetHeight = -1;
let imageUrl = '';
let footer = '';

if (process.argv.length < 3) {
  downloadRandomImageList();
} else {
  imageFilename = process.argv[2];
  processExistingImage(process.argv[2]);
}

function downloadRandomImageList(pagename) {
  if (!pagename) {
    pagename = 'https://commons.wikimedia.org/wiki/Special:Random/File';
  }

  superagent
    .get(pagename)
    .end((err, res) => {
      if (err) {
        console.log(err);
        return;
      }

      if (res.status !== 200) {
        console.log(`Failed with HTTP status code ${res.status}.`);
        return;
      }

      downloadAndProcessImage(res.text);
    });
}

function downloadAndProcessImage(html) {
  const line = html
    .split('\n')
    .filter((line) => line.indexOf('<img alt="File:') >= 0)[0];
  const src = ' src="';
  const urlStart = line.indexOf(src) + src.length;
  const urlEnd = line.indexOf('"', urlStart);

  imageUrl = line.slice(urlStart, urlEnd);
  superagent
    .get(imageUrl)
    .set('User-Agent', 'Picture-to-Nonogram Downloader')
    .end((err, res) => {
      if (err) {
        console.log(err);
        return;
      }

      if (res.status !== 200) {
        console.log(`Download failed with HTTP status code ${res.status}.`);
        return;
      }

      fs.writeFileSync(imageFilename, res.body);
      im.identify(imageFilename, processFileInfo);
    });
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

  if (targetWidth * targetHeight > minimumSize * minimumSize * 2) {
    const newRatio = simplifyAspectRatio(targetWidth / targetHeight, 50);

    targetWidth = newRatio[0];
    targetHeight = newRatio[1];
  }

  while (targetWidth * targetHeight > minimumSize * minimumSize * 3) {
    let ratio = targetWidth / targetHeight;

    if (ratio > 1) {
      if (ratio < 1.5) {
        targetWidth -= 1;
      } else {
        targetWidth += 1;
      }
    } else {
      if (ratio < 1.5) {
        targetWidth += 1;
      } else {
        targetWidth -= 1;
      }
    }

    ratio = targetWidth / targetHeight;
    const newRatio = simplifyAspectRatio(ratio, 50);

    targetWidth = newRatio[0];
    targetHeight = newRatio[1];
  }

  if (targetWidth * targetHeight < minimumSize * minimumSize) {
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

  if (stdout) {
    console.log(stdout);
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

  const image = encodeImage(imageFilename);
  let html = fs.readFileSync('template.html').toString();

  let gridHtml = '';
  grid.forEach((row) => {
    gridHtml += '    [';
    row.forEach((cell) => {
      gridHtml += `[${cell}],`;
    });
    gridHtml += '],\n';
  });

  let tableHtml = '    <tr>\n      <th>';
  tableHtml += `${grid[0].length}x${grid.length} puzzle<br>\n`;
  tableHtml += 'Time: <span id="timer"></span></th>\n';
  for (let col = 0; col < RleByColumn.length; col++) {
    const header = RleByColumn[col].join('<br>');
    tableHtml += `      <th class="ch" id="col-${col}">${header}</th>\n`;
  }

  tableHtml += '    </tr>\n';
  for (let row = 0; row < RleByRow.length; row++) {
    let header = RleByRow[row].join('&nbsp;&nbsp;');
    if (header.length === 0) {
      header = '&nbsp;';
    }

    tableHtml += `    <tr>\n      <th class="rh" id="row-${row}">${header}</th>\n`;
    for (let col = 0; col < RleByColumn.length; col++) {
      tableHtml += `      <td id="${row}-${col}"`;
      tableHtml += ` onclick="handleClick(${row},${col})"`
      tableHtml += ` oncontextmenu="handleContextmenu(${row},${col}); return false;"`
      tableHtml += ` onmouseenter="handleMouseEnter(${row},${col})"`
      tableHtml += ` onmouseleave="handleMouseLeave(${row},${col})"`
      tableHtml += '></td>\n';
    }
    tableHtml += '    </tr>\n';
  }

  let imgHtml = '  <img class="hidden" id="result"';
  imgHtml += ` style="width: calc(${RleByColumn.length}*1.58em)"`;
  imgHtml += ` src="data:image/png;base64,${image}">\n`;

  const extension = imageUrl.lastIndexOf('.');
  const idStart = imageUrl.lastIndexOf('-') + 1;
  const imageId = imageUrl.slice(idStart, extension);
  let credit = `  <a href="https://pxhere.com/en/photo/${imageId}">`
    + 'Original image</a>';

  try {
    footer = fs.readFileSync('footer.html').toString();
  } catch (e) {
  }

  html = html
    .replace('<!--INSERT_GRID_DATA-->', gridHtml)
    .replace('<!--INSERT_TABLE-->', tableHtml)
    .replace('<!--INSERT_IMAGE-->', imgHtml)
    .replace('<!--INSERT_CREDIT-->', credit)
    .replace('<!--INSERT_FOOTER-->', footer);

  fs.writeFileSync('output.html', html);
  fs.unlinkSync(smallFilename);
  fs.unlinkSync(bwFilename);
  fs.unlinkSync(imageFilename);
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

  for (let i = 0; i < height; i++) {
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

function encodeImage(filename) {
  const imageBinary = fs.readFileSync(filename);
  return imageBinary.toString('base64');
}

