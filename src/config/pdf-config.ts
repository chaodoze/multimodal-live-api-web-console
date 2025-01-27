const MB = 1024 * 1024;

// Configuration for PDF file handling
export const PDF_CONFIG = {
  MAX_FILE_SIZE: 10 * MB,
  ACCEPTED_MIME_TYPE: "application/pdf"
};

// Get configuration from environment
export const getGenerationConfig = () => ({
  temperature: Number(process.env.REACT_APP_TEMPERATURE),
  maxOutputTokens: Number(process.env.REACT_APP_MAX_TOKENS)
});
