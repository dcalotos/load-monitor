import Resolver from '@forge/resolver';
import api, { route, fetch } from '@forge/api';
import OpenAI from 'openai';

const resolver = new Resolver();

/**
 * Resolver to fetch labels from a Jira issue
 * @param {Object} req - The request object containing context information
 * @returns {Array} Array of labels from the issue
 */
resolver.define('fetchLabels', async (req) => {
  const key = req.context.extension.issue.key;

  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${key}?fields=labels`);

  const data = await res.json();

  const label = data.fields.labels;
  if (label == undefined) {
    console.warn(`${key}: Failed to find labels`);
    return [];
  }

  return label;
});

/**
 * Resolver to call OpenAI API
 * This function demonstrates how to integrate OpenAI with Forge
 * @param {Object} req - The request object containing the payload with prompt and other parameters
 * @returns {Object} The response from OpenAI API
 */
resolver.define('callOpenAI', async (req) => {
  try {
    // Get the API key from Forge environment variables
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error('OpenAI API key not found in environment variables');
      return { error: 'API key not configured' };
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    // Get parameters from the request payload
    const { prompt, model = 'gpt-3.5-turbo', maxTokens = 150, temperature = 0.7 } = req.payload;

    if (!prompt) {
      return { error: 'Prompt is required' };
    }

    console.log(`Calling OpenAI with prompt: ${prompt.substring(0, 50)}...`);

    // Make the API call to OpenAI
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: temperature,
    });

    // Extract the response
    const response = completion.choices[0].message.content;

    console.log('OpenAI response received successfully');

    return {
      success: true,
      response: response,
      usage: completion.usage,
    };

  } catch (error) {
    console.error('Error calling OpenAI API:', error);
    return {
      error: error.message || 'Failed to call OpenAI API',
      success: false,
    };
  }
});

/**
 * Resolver to analyze a Jira issue using OpenAI
 * This function fetches issue details and uses OpenAI to provide insights
 * @param {Object} req - The request object containing context information
 * @returns {Object} Analysis results from OpenAI
 */
resolver.define('analyzeIssueWithAI', async (req) => {
  try {
    const key = req.context.extension.issue.key;

    // Fetch issue details from Jira
    const res = await api.asUser().requestJira(
      route`/rest/api/3/issue/${key}?fields=summary,description,labels,priority,status`
    );

    const data = await res.json();

    // Construct a prompt for OpenAI based on the issue details
    const prompt = `Analyze this Jira issue and provide insights:
    
Summary: ${data.fields.summary}
Description: ${data.fields.description || 'No description provided'}
Labels: ${data.fields.labels?.join(', ') || 'None'}
Priority: ${data.fields.priority?.name || 'Not set'}
Status: ${data.fields.status?.name || 'Unknown'}

Please provide:
1. A brief analysis of the issue
2. Potential concerns or risks
3. Suggestions for resolution`;

    // Get the API key from environment variables
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error('OpenAI API key not found in environment variables');
      return { error: 'API key not configured' };
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    console.log(`Analyzing issue ${key} with OpenAI`);

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.7,
    });

    const analysis = completion.choices[0].message.content;

    console.log(`Analysis for issue ${key} completed successfully`);

    return {
      success: true,
      issueKey: key,
      analysis: analysis,
      usage: completion.usage,
    };

  } catch (error) {
    console.error('Error analyzing issue with AI:', error);
    return {
      error: error.message || 'Failed to analyze issue',
      success: false,
    };
  }
});

export const handler = resolver.getDefinitions();
