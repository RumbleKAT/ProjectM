const { CreatePptxPresentation } = require("./pptx/create-presentation.js");
const { CreateTextFile } = require("./text/create-text-file.js");
const { CreatePdfFile } = require("./pdf/create-pdf-file.js");
const { CreateExcelFile } = require("./xlsx/create-excel-file.js");
const { CreateDocxFile } = require("./docx/create-docx-file.js");
const { CreateClientCsvFile } = require("./csv/create-client-csv.js");

const createFilesAgent = {
  name: "create-files-agent",
  startupConfig: {
    params: {},
  },
  plugin: [
    CreatePptxPresentation,
    CreateTextFile,
    CreatePdfFile,
    CreateExcelFile,
    CreateDocxFile,
    CreateClientCsvFile,
  ],
};

module.exports = {
  createFilesAgent,
};
