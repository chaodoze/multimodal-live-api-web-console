// Environment configuration handler
const requiredEnvVars = ['REACT_APP_GEMINI_MODEL'] as const;

// Validate required environment variables
const validateEnv = () => {
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

// Get validated environment configuration
export const getEnvConfig = () => {
  validateEnv();
  return {
    model: process.env.REACT_APP_GEMINI_MODEL as string,
    temperature: Number(process.env.REACT_APP_TEMPERATURE) || undefined,
    maxOutputTokens: Number(process.env.REACT_APP_MAX_TOKENS) || undefined
  };
};
