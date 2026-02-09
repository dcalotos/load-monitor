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

// ============================================
// AI-POWERED TICKET LOAD EVALUATION SYSTEM
// Evaluates tickets based on 4 pillars with weighted scoring
// ============================================

/**
 * Resolver to evaluate a ticket's cognitive load using AI
 * 
 * This resolver analyzes a Jira ticket based on 4 key pillars:
 * - Ambigüedad (30%): Clarity of requirements and description
 * - Complejidad Técnica (40%): Technical complexity and core system involvement
 * - Riesgo de Context Switching (20%): Required knowledge across multiple system areas
 * - Deuda Técnica (10%): Legacy code and technical debt involvement
 * 
 * Returns a score from 1-10 with detailed breakdown and automatically stores the result
 * 
 * @param {Object} req - The request object with issue context
 * @returns {Object} Evaluation results with score, breakdown, and storage confirmation
 */
resolver.define('evaluateTicketLoad', async (req) => {
  try {
    const issueKey = req.context.extension.issue.key;

    if (!issueKey) {
      return { error: 'Issue context not found', success: false };
    }

    console.log(`Starting ticket load evaluation for ${issueKey}`);

    // Fetch comprehensive issue details from Jira
    const res = await api.asUser().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=summary,description,labels,priority,status,issuetype,components,customfield_10020`
    );

    const data = await res.json();

    // Extract issue information
    const summary = data.fields.summary || 'No summary';
    const description = data.fields.description || 'No description provided';
    const labels = data.fields.labels?.join(', ') || 'None';
    const priority = data.fields.priority?.name || 'Not set';
    const status = data.fields.status?.name || 'Unknown';
    const issueType = data.fields.issuetype?.name || 'Unknown';
    const components = data.fields.components?.map(c => c.name).join(', ') || 'None';

    // Get the API key from environment variables
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error('OpenAI API key not found in environment variables');
      return { error: 'API key not configured', success: false };
    }

    // Construct the specialized prompt for the AI evaluation
    const systemPrompt = `Actúa como un Senior Technical Program Manager. Tu tarea es analizar tickets de Jira y evaluar su carga cognitiva bajo 4 pilares específicos.

PILARES DE EVALUACIÓN:
1. Ambigüedad (30%): ¿La descripción es clara o faltan requisitos? ¿Los criterios de aceptación están bien definidos? A mayor ambigüedad, más carga cognitiva.

2. Complejidad Técnica (40%): ¿Involucra cambios en el "core" del sistema, refactorización profunda o integraciones críticas? ¿Afecta lógica de negocio crítica como pagos, seguridad o autenticación?

3. Riesgo de Context Switching (20%): ¿El ticket requiere conocimientos de múltiples áreas del sistema a la vez? ¿Necesita cambios en frontend, backend, base de datos y terceros simultáneamente?

4. Deuda Técnica (10%): ¿El ticket menciona "legacy code", "fixes" temporales, código antiguo o workarounds? ¿Requiere lidiar con código heredado?

CRITERIOS DE PUNTUACIÓN (1-10):
- 1-3: Tareas mecánicas (cambios de UI menores, documentación, textos, configuraciones simples)
- 4-6: Desarrollo estándar (nuevas features pequeñas, bugs localizados en un área específica)
- 7-8: Alta carga (arquitectura, múltiples áreas, integraciones complejas)
- 9-10: Carga crítica (bugs intermitentes, cambios en lógica de pagos/seguridad/core, refactorizaciones masivas)

Debes devolver ÚNICAMENTE un JSON válido con este formato exacto:
{
  "score": <número del 1 al 10>,
  "reason": "<explicación breve en máximo 15 palabras>",
  "breakdown": {
    "ambiguity": <número del 1 al 10>,
    "technical_complexity": <número del 1 al 10>,
    "context_switching": <número del 1 al 10>,
    "technical_debt": <número del 1 al 10>
  }
}`;

    const userPrompt = `Analiza este ticket de Jira:

TIPO: ${issueType}
TÍTULO: ${summary}
DESCRIPCIÓN: ${description}
PRIORIDAD: ${priority}
ESTADO: ${status}
ETIQUETAS: ${labels}
COMPONENTES: ${components}

Evalúa este ticket según los 4 pilares y devuelve el JSON con el score final y el desglose.`;

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    console.log(`Calling OpenAI for ticket evaluation: ${issueKey}`);

    // Call OpenAI API with structured output
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 0.3, // Lower temperature for more consistent scoring
      response_format: { type: 'json_object' } // Force JSON response
    });

    const aiResponse = completion.choices[0].message.content;
    console.log(`AI Response for ${issueKey}:`, aiResponse);

    // Parse the AI response
    let evaluation;
    try {
      evaluation = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      return {
        error: 'Failed to parse AI evaluation response',
        success: false,
        rawResponse: aiResponse
      };
    }

    // Validate the evaluation structure
    if (!evaluation.score || !evaluation.reason || !evaluation.breakdown) {
      console.error('Invalid evaluation structure:', evaluation);
      return {
        error: 'Invalid evaluation structure from AI',
        success: false,
        evaluation: evaluation
      };
    }

    // Ensure score is within valid range
    const finalScore = Math.min(10, Math.max(1, Math.round(evaluation.score)));

    // Prepare metadata with detailed breakdown
    const metadata = {
      evaluationMethod: 'ai-4-pillars',
      breakdown: {
        ambiguity: evaluation.breakdown.ambiguity || 0,
        technicalComplexity: evaluation.breakdown.technical_complexity || 0,
        contextSwitching: evaluation.breakdown.context_switching || 0,
        technicalDebt: evaluation.breakdown.technical_debt || 0
      },
      weights: {
        ambiguity: '30%',
        technicalComplexity: '40%',
        contextSwitching: '20%',
        technicalDebt: '10%'
      },
      reason: evaluation.reason,
      issueType: issueType,
      priority: priority,
      evaluatedAt: new Date().toISOString(),
      tokensUsed: completion.usage.total_tokens,
      model: 'gpt-4o-mini'
    };

    console.log(`Evaluation complete for ${issueKey}. Score: ${finalScore}`);

    // Automatically save the score to storage
    const scoreData = {
      issueKey: issueKey,
      score: finalScore,
      metadata: metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: req.context.accountId,
    };

    const storageKey = `ticket-score:${issueKey}`;
    await storage.set(storageKey, scoreData);

    console.log(`Score ${finalScore} saved to storage for ${issueKey}`);

    return {
      success: true,
      issueKey: issueKey,
      score: finalScore,
      reason: evaluation.reason,
      breakdown: {
        ambiguity: evaluation.breakdown.ambiguity || 0,
        technicalComplexity: evaluation.breakdown.technical_complexity || 0,
        contextSwitching: evaluation.breakdown.context_switching || 0,
        technicalDebt: evaluation.breakdown.technical_debt || 0
      },
      weights: {
        ambiguity: '30%',
        technicalComplexity: '40%',
        contextSwitching: '20%',
        technicalDebt: '10%'
      },
      metadata: metadata,
      stored: true,
      message: `Ticket evaluated and score saved: ${finalScore}/10`
    };

  } catch (error) {
    console.error('Error evaluating ticket load:', error);
    return {
      error: error.message || 'Failed to evaluate ticket load',
      success: false,
      details: error.stack
    };
  }
});

/**
 * Resolver to evaluate a specific ticket by issue key
 * Same as evaluateTicketLoad but accepts an issue key as parameter
 * 
 * @param {Object} req - The request object with payload containing issueKey
 * @returns {Object} Evaluation results with score, breakdown, and storage confirmation
 */
resolver.define('evaluateTicketByKey', async (req) => {
  try {
    const { issueKey } = req.payload;

    if (!issueKey) {
      return { error: 'Issue key is required', success: false };
    }

    console.log(`Starting ticket load evaluation for ${issueKey}`);

    // Fetch comprehensive issue details from Jira
    const res = await api.asUser().requestJira(
      route`/rest/api/3/issue/${issueKey}?fields=summary,description,labels,priority,status,issuetype,components,customfield_10020`
    );

    const data = await res.json();

    // Extract issue information
    const summary = data.fields.summary || 'No summary';
    const description = data.fields.description || 'No description provided';
    const labels = data.fields.labels?.join(', ') || 'None';
    const priority = data.fields.priority?.name || 'Not set';
    const status = data.fields.status?.name || 'Unknown';
    const issueType = data.fields.issuetype?.name || 'Unknown';
    const components = data.fields.components?.map(c => c.name).join(', ') || 'None';

    // Get the API key from environment variables
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey) {
      console.error('OpenAI API key not found in environment variables');
      return { error: 'API key not configured', success: false };
    }

    // Construct the specialized prompt for the AI evaluation
    const systemPrompt = `Actúa como un Senior Technical Program Manager. Tu tarea es analizar tickets de Jira y evaluar su carga cognitiva bajo 4 pilares específicos.

PILARES DE EVALUACIÓN:
1. Ambigüedad (30%): ¿La descripción es clara o faltan requisitos? ¿Los criterios de aceptación están bien definidos? A mayor ambigüedad, más carga cognitiva.

2. Complejidad Técnica (40%): ¿Involucra cambios en el "core" del sistema, refactorización profunda o integraciones críticas? ¿Afecta lógica de negocio crítica como pagos, seguridad o autenticación?

3. Riesgo de Context Switching (20%): ¿El ticket requiere conocimientos de múltiples áreas del sistema a la vez? ¿Necesita cambios en frontend, backend, base de datos y terceros simultáneamente?

4. Deuda Técnica (10%): ¿El ticket menciona "legacy code", "fixes" temporales, código antiguo o workarounds? ¿Requiere lidiar con código heredado?

CRITERIOS DE PUNTUACIÓN (1-10):
- 1-3: Tareas mecánicas (cambios de UI menores, documentación, textos, configuraciones simples)
- 4-6: Desarrollo estándar (nuevas features pequeñas, bugs localizados en un área específica)
- 7-8: Alta carga (arquitectura, múltiples áreas, integraciones complejas)
- 9-10: Carga crítica (bugs intermitentes, cambios en lógica de pagos/seguridad/core, refactorizaciones masivas)

Debes devolver ÚNICAMENTE un JSON válido con este formato exacto:
{
  "score": <número del 1 al 10>,
  "reason": "<explicación breve en máximo 15 palabras>",
  "breakdown": {
    "ambiguity": <número del 1 al 10>,
    "technical_complexity": <número del 1 al 10>,
    "context_switching": <número del 1 al 10>,
    "technical_debt": <número del 1 al 10>
  }
}`;

    const userPrompt = `Analiza este ticket de Jira:

TIPO: ${issueType}
TÍTULO: ${summary}
DESCRIPCIÓN: ${description}
PRIORIDAD: ${priority}
ESTADO: ${status}
ETIQUETAS: ${labels}
COMPONENTES: ${components}

Evalúa este ticket según los 4 pilares y devuelve el JSON con el score final y el desglose.`;

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: apiKey,
    });

    console.log(`Calling OpenAI for ticket evaluation: ${issueKey}`);

    // Call OpenAI API with structured output
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    const aiResponse = completion.choices[0].message.content;
    console.log(`AI Response for ${issueKey}:`, aiResponse);

    // Parse the AI response
    let evaluation;
    try {
      evaluation = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      return {
        error: 'Failed to parse AI evaluation response',
        success: false,
        rawResponse: aiResponse
      };
    }

    // Validate the evaluation structure
    if (!evaluation.score || !evaluation.reason || !evaluation.breakdown) {
      console.error('Invalid evaluation structure:', evaluation);
      return {
        error: 'Invalid evaluation structure from AI',
        success: false,
        evaluation: evaluation
      };
    }

    // Ensure score is within valid range
    const finalScore = Math.min(10, Math.max(1, Math.round(evaluation.score)));

    // Prepare metadata with detailed breakdown
    const metadata = {
      evaluationMethod: 'ai-4-pillars',
      breakdown: {
        ambiguity: evaluation.breakdown.ambiguity || 0,
        technicalComplexity: evaluation.breakdown.technical_complexity || 0,
        contextSwitching: evaluation.breakdown.context_switching || 0,
        technicalDebt: evaluation.breakdown.technical_debt || 0
      },
      weights: {
        ambiguity: '30%',
        technicalComplexity: '40%',
        contextSwitching: '20%',
        technicalDebt: '10%'
      },
      reason: evaluation.reason,
      issueType: issueType,
      priority: priority,
      evaluatedAt: new Date().toISOString(),
      tokensUsed: completion.usage.total_tokens,
      model: 'gpt-4o-mini'
    };

    console.log(`Evaluation complete for ${issueKey}. Score: ${finalScore}`);

    // Automatically save the score to storage
    const scoreData = {
      issueKey: issueKey,
      score: finalScore,
      metadata: metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: req.context.accountId,
    };

    const storageKey = `ticket-score:${issueKey}`;
    await storage.set(storageKey, scoreData);

    console.log(`Score ${finalScore} saved to storage for ${issueKey}`);

    return {
      success: true,
      issueKey: issueKey,
      score: finalScore,
      reason: evaluation.reason,
      breakdown: {
        ambiguity: evaluation.breakdown.ambiguity || 0,
        technicalComplexity: evaluation.breakdown.technical_complexity || 0,
        contextSwitching: evaluation.breakdown.context_switching || 0,
        technicalDebt: evaluation.breakdown.technical_debt || 0
      },
      weights: {
        ambiguity: '30%',
        technicalComplexity: '40%',
        contextSwitching: '20%',
        technicalDebt: '10%'
      },
      metadata: metadata,
      stored: true,
      message: `Ticket evaluated and score saved: ${finalScore}/10`
    };

  } catch (error) {
    console.error('Error evaluating ticket load:', error);
    return {
      error: error.message || 'Failed to evaluate ticket load',
      success: false,
      details: error.stack
    };
  }
});

export const handler = resolver.getDefinitions();
