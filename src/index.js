import Resolver from '@forge/resolver';
import api, { route, fetch, storage } from '@forge/api';
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

// ============================================
// TICKET SCORE STORAGE RESOLVERS
// GDPR-compliant storage using Forge Storage API
// ============================================

/**
 * Resolver to save or update a ticket score
 * Stores scores in Forge Storage (GDPR compliant - data stays within Atlassian)
 * @param {Object} req - The request object containing payload with issueKey and score
 * @returns {Object} Success status and saved data
 */
resolver.define('saveTicketScore', async (req) => {
  try {
    const { issueKey, score, metadata = {} } = req.payload;

    if (!issueKey) {
      return { error: 'Issue key is required', success: false };
    }

    if (score === undefined || score === null) {
      return { error: 'Score is required', success: false };
    }

    // Validate score is a number
    if (typeof score !== 'number') {
      return { error: 'Score must be a number', success: false };
    }

    // Create the score data object
    const scoreData = {
      issueKey: issueKey,
      score: score,
      metadata: metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: req.context.accountId, // Store who updated the score
    };

    // Store in Forge Storage using the issue key as the storage key
    // Format: ticket-score:{issueKey}
    const storageKey = `ticket-score:${issueKey}`;
    await storage.set(storageKey, scoreData);

    console.log(`Saved score ${score} for issue ${issueKey}`);

    return {
      success: true,
      data: scoreData,
      message: `Score saved successfully for ${issueKey}`,
    };

  } catch (error) {
    console.error('Error saving ticket score:', error);
    return {
      error: error.message || 'Failed to save ticket score',
      success: false,
    };
  }
});

/**
 * Resolver to get a ticket score
 * Retrieves score data from Forge Storage
 * @param {Object} req - The request object containing payload with issueKey
 * @returns {Object} The stored score data or null if not found
 */
resolver.define('getTicketScore', async (req) => {
  try {
    const { issueKey } = req.payload;

    if (!issueKey) {
      return { error: 'Issue key is required', success: false };
    }

    // Retrieve from Forge Storage
    const storageKey = `ticket-score:${issueKey}`;
    const scoreData = await storage.get(storageKey);

    if (!scoreData) {
      console.log(`No score found for issue ${issueKey}`);
      return {
        success: true,
        data: null,
        message: `No score found for ${issueKey}`,
      };
    }

    console.log(`Retrieved score for issue ${issueKey}: ${scoreData.score}`);

    return {
      success: true,
      data: scoreData,
    };

  } catch (error) {
    console.error('Error getting ticket score:', error);
    return {
      error: error.message || 'Failed to get ticket score',
      success: false,
    };
  }
});

/**
 * Resolver to get scores for multiple tickets
 * Useful for batch operations or displaying scores in lists
 * @param {Object} req - The request object containing payload with issueKeys array
 * @returns {Object} Map of issue keys to their score data
 */
resolver.define('getMultipleTicketScores', async (req) => {
  try {
    const { issueKeys } = req.payload;

    if (!issueKeys || !Array.isArray(issueKeys)) {
      return { error: 'Issue keys array is required', success: false };
    }

    const scores = {};
    
    // Retrieve all scores in parallel for better performance
    const promises = issueKeys.map(async (issueKey) => {
      const storageKey = `ticket-score:${issueKey}`;
      const scoreData = await storage.get(storageKey);
      if (scoreData) {
        scores[issueKey] = scoreData;
      }
    });

    await Promise.all(promises);

    console.log(`Retrieved scores for ${Object.keys(scores).length} out of ${issueKeys.length} issues`);

    return {
      success: true,
      data: scores,
      count: Object.keys(scores).length,
    };

  } catch (error) {
    console.error('Error getting multiple ticket scores:', error);
    return {
      error: error.message || 'Failed to get ticket scores',
      success: false,
    };
  }
});

/**
 * Resolver to delete a ticket score
 * Removes score data from Forge Storage
 * @param {Object} req - The request object containing payload with issueKey
 * @returns {Object} Success status
 */
resolver.define('deleteTicketScore', async (req) => {
  try {
    const { issueKey } = req.payload;

    if (!issueKey) {
      return { error: 'Issue key is required', success: false };
    }

    // Delete from Forge Storage
    const storageKey = `ticket-score:${issueKey}`;
    await storage.delete(storageKey);

    console.log(`Deleted score for issue ${issueKey}`);

    return {
      success: true,
      message: `Score deleted successfully for ${issueKey}`,
    };

  } catch (error) {
    console.error('Error deleting ticket score:', error);
    return {
      error: error.message || 'Failed to delete ticket score',
      success: false,
    };
  }
});

/**
 * Resolver to get the current issue's score
 * Automatically uses the issue context - no need to pass issue key
 * @param {Object} req - The request object with issue context
 * @returns {Object} The stored score data for the current issue
 */
resolver.define('getCurrentIssueScore', async (req) => {
  try {
    const issueKey = req.context.extension.issue.key;

    if (!issueKey) {
      return { error: 'Issue context not found', success: false };
    }

    // Retrieve from Forge Storage
    const storageKey = `ticket-score:${issueKey}`;
    const scoreData = await storage.get(storageKey);

    if (!scoreData) {
      console.log(`No score found for current issue ${issueKey}`);
      return {
        success: true,
        data: null,
        issueKey: issueKey,
        message: `No score found for ${issueKey}`,
      };
    }

    console.log(`Retrieved score for current issue ${issueKey}: ${scoreData.score}`);

    return {
      success: true,
      data: scoreData,
      issueKey: issueKey,
    };

  } catch (error) {
    console.error('Error getting current issue score:', error);
    return {
      error: error.message || 'Failed to get current issue score',
      success: false,
    };
  }
});

/**
 * Resolver to save a score for the current issue
 * Automatically uses the issue context - no need to pass issue key
 * @param {Object} req - The request object with issue context and payload with score
 * @returns {Object} Success status and saved data
 */
resolver.define('saveCurrentIssueScore', async (req) => {
  try {
    const issueKey = req.context.extension.issue.key;
    const { score, metadata = {} } = req.payload;

    if (!issueKey) {
      return { error: 'Issue context not found', success: false };
    }

    if (score === undefined || score === null) {
      return { error: 'Score is required', success: false };
    }

    // Validate score is a number
    if (typeof score !== 'number') {
      return { error: 'Score must be a number', success: false };
    }

    // Create the score data object
    const scoreData = {
      issueKey: issueKey,
      score: score,
      metadata: metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: req.context.accountId,
    };

    // Store in Forge Storage
    const storageKey = `ticket-score:${issueKey}`;
    await storage.set(storageKey, scoreData);

    console.log(`Saved score ${score} for current issue ${issueKey}`);

    return {
      success: true,
      data: scoreData,
      issueKey: issueKey,
      message: `Score saved successfully for ${issueKey}`,
    };

  } catch (error) {
    console.error('Error saving current issue score:', error);
    return {
      error: error.message || 'Failed to save current issue score',
      success: false,
    };
  }
});

export const handler = resolver.getDefinitions();
