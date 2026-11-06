"use strict";

const fs = require("node:fs");

module.exports = function readSource(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
};
