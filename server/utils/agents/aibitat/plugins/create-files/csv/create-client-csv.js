const createFilesLib = require("../lib.js");

module.exports.CreateClientCsvFile = {
  name: "create-client-csv",
  plugin: function () {
    return {
      name: "create-client-csv",
      setup(aibitat) {
        aibitat.function({
          super: aibitat,
          name: this.name,
          description:
            "Creates a CSV file by sending JSON data to the client, where it will be converted to CSV and downloaded. " +
            "Use this tool when the user asks to generate a CSV file from data. " +
            "Do NOT use this tool if you need the file to be processed by other server-side tools, as it won't be saved on the server.",
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              filename: {
                type: "string",
                description: "The filename for the generated CSV file (e.g., 'data.csv')",
              },
              jsonData: {
                type: "array",
                description: "The JSON data array to be converted to CSV. Each item in the array should be an object representing a row.",
                items: {
                  type: "object",
                },
              },
            },
            required: ["filename", "jsonData"],
            additionalProperties: false,
          },
          handler: async function ({ filename = "data.csv", jsonData = [] }) {
            try {
              this.super.handlerProps.log(`Using the create-client-csv tool.`);

              if (!Array.isArray(jsonData) || jsonData.length === 0) {
                return "Error: You must provide 'jsonData' as a non-empty array of objects.";
              }

              const hasExtension = /\.csv$/i.test(filename);
              if (!hasExtension) filename = `${filename}.csv`;

              this.super.introspect(
                `${this.caller}: Triggering client-side CSV generation for "${filename}" with ${jsonData.length} row(s)`
              );

              if (this.super.requestToolApproval) {
                const approval = await this.super.requestToolApproval({
                  skillName: this.name,
                  payload: {
                    filename,
                    rowCount: jsonData.length,
                  },
                  description: `Generate CSV file "${filename}" on the client`,
                });
                if (!approval.approved) {
                  this.super.introspect(
                    `${this.caller}: User rejected the ${this.name} request.`
                  );
                  return approval.message;
                }
              }

              // Send a specific card format to the client
              this.super.socket.send("clientCsvDownloadCard", {
                filename,
                csvData: jsonData, // We send JSON data, and the client papaparse will stringify it to CSV
              });

              this.super.introspect(
                `${this.caller}: Successfully requested client-side CSV generation for "${filename}"`
              );

              return `Successfully instructed the client to generate and download the CSV file "${filename}".`;
            } catch (e) {
              this.super.handlerProps.log(
                `create-client-csv error: ${e.message}`
              );
              this.super.introspect(`Error: ${e.message}`);
              return `Error triggering client CSV generation: ${e.message}`;
            }
          },
        });
      },
    };
  },
};
