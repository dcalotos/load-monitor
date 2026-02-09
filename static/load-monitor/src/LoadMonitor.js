import React, { useEffect, useState } from 'react';
import { events, invoke } from '@forge/bridge';
import styled from 'styled-components';

// Styled Components
const Container = styled.div`
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 2px solid #DFE1E6;
`;

const Logo = styled.div`
  width: 32px;
  height: 32px;
  background: linear-gradient(135deg, #0052CC 0%, #2684FF 100%);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  font-weight: bold;
  color: white;
  font-size: 16px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #172B4D;
`;

const ProgressBarContainer = styled.div`
  margin: 16px 0;
`;

const ProgressBarLabel = styled.div`
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
  color: #42526E;
`;

const ProgressBarTrack = styled.div`
  width: 100%;
  height: 8px;
  background-color: #DFE1E6;
  border-radius: 4px;
  overflow: hidden;
`;

const ProgressBarFill = styled.div`
  height: 100%;
  width: ${props => props.value}%;
  background-color: ${props => props.color};
  transition: width 0.3s ease, background-color 0.3s ease;
  border-radius: 4px;
`;

const SectionMessage = styled.div`
  padding: 12px 16px;
  border-radius: 3px;
  margin: 16px 0;
  background-color: ${props => props.appearance === 'warning' ? '#FFFAE6' : props.appearance === 'success' ? '#E3FCEF' : '#DEEBFF'};
  border-left: 4px solid ${props => props.appearance === 'warning' ? '#FF8B00' : props.appearance === 'success' ? '#36B37E' : '#0052CC'};
`;

const MessageTitle = styled.div`
  font-weight: 600;
  margin-bottom: 4px;
  color: #172B4D;
  font-size: 14px;
`;

const MessageText = styled.div`
  font-size: 13px;
  color: #42526E;
  line-height: 1.5;
`;

const Button = styled.button`
  background-color: #0052CC;
  color: white;
  border: none;
  border-radius: 3px;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  
  &:hover {
    background-color: #0065FF;
  }
  
  &:disabled {
    background-color: #A5ADBA;
    cursor: not-allowed;
  }
`;

const BreakdownContainer = styled.div`
  margin-top: 16px;
  padding: 12px;
  background-color: #F4F5F7;
  border-radius: 3px;
`;

const BreakdownTitle = styled.div`
  font-weight: 600;
  margin-bottom: 12px;
  color: #172B4D;
  font-size: 14px;
`;

const BreakdownItem = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
  color: #42526E;
`;

const BreakdownLabel = styled.span`
  flex: 1;
`;

const BreakdownValue = styled.span`
  font-weight: 600;
  color: #172B4D;
  margin-left: 8px;
`;

const Spinner = styled.div`
  border: 3px solid #DFE1E6;
  border-top: 3px solid #0052CC;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  animation: spin 1s linear infinite;
  margin: 20px auto;
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

function LoadMonitor() {
  const [evaluation, setEvaluation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Get color based on score
   * Green (#36B37E) for score 1-4
   * Yellow (#FFAB00) for score 5-7
   * Red (#FF5630) for score 8-10
   */
  const getScoreColor = (score) => {
    if (score <= 4) return '#36B37E'; // Green
    if (score <= 7) return '#FFAB00'; // Yellow
    return '#FF5630'; // Red
  };

  /**
   * Get score label based on value
   */
  const getScoreLabel = (score) => {
    if (score <= 4) return 'Low Load';
    if (score <= 7) return 'Medium Load';
    return 'High Load';
  };

  /**
   * Load existing score from storage on component mount
   */
  useEffect(() => {
    loadExistingScore();
    
    // Subscribe to issue change events to reload score
    const subscribeForIssueChangedEvent = () =>
      events.on('JIRA_ISSUE_CHANGED', () => {
        loadExistingScore();
      });
    const subscription = subscribeForIssueChangedEvent();

    return () => {
      subscription.then((sub) => sub.unsubscribe());
    };
  }, []);

  /**
   * Load existing score from storage
   */
  const loadExistingScore = async () => {
    try {
      const result = await invoke('getCurrentIssueScore');
      if (result.success && result.data) {
        // Transform stored data to match evaluation format
        setEvaluation({
          score: result.data.score,
          reason: result.data.metadata.reason,
          breakdown: result.data.metadata.breakdown,
          weights: result.data.metadata.weights,
          issueKey: result.data.issueKey,
        });
      }
    } catch (err) {
      console.error('Failed to load existing score:', err);
    }
  };

  /**
   * Evaluate the current ticket
   */
  const handleEvaluate = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await invoke('evaluateTicketLoad');

      if (result.success) {
        setEvaluation({
          score: result.score,
          reason: result.reason,
          breakdown: result.breakdown,
          weights: result.weights,
          issueKey: result.issueKey,
        });
      } else {
        setError(result.error || 'Failed to evaluate ticket');
      }
    } catch (err) {
      console.error('Evaluation failed:', err);
      setError('Failed to evaluate ticket. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container>
      {/* Header with Logo */}
      <Header>
        <Logo>JP</Logo>
        <Title>Jira Pulse - Cognitive Load Monitor</Title>
      </Header>

      {/* Evaluate Button */}
      <Button onClick={handleEvaluate} disabled={loading}>
        {loading ? 'Evaluating...' : evaluation ? 'Re-evaluate Ticket' : 'Evaluate Ticket Load'}
      </Button>

      {/* Loading Spinner */}
      {loading && <Spinner />}

      {/* Error Message */}
      {error && (
        <SectionMessage appearance="warning">
          <MessageTitle>⚠️ Error</MessageTitle>
          <MessageText>{error}</MessageText>
        </SectionMessage>
      )}

      {/* Evaluation Results */}
      {evaluation && !loading && (
        <>
          {/* Progress Bar */}
          <ProgressBarContainer>
            <ProgressBarLabel>
              <span><strong>Cognitive Load Score:</strong> {getScoreLabel(evaluation.score)}</span>
              <span><strong>{evaluation.score}/10</strong></span>
            </ProgressBarLabel>
            <ProgressBarTrack>
              <ProgressBarFill value={evaluation.score * 10} color={getScoreColor(evaluation.score)} />
            </ProgressBarTrack>
          </ProgressBarContainer>

          {/* Reason */}
          <SectionMessage appearance="success">
            <MessageTitle>💡 AI Analysis</MessageTitle>
            <MessageText>{evaluation.reason}</MessageText>
          </SectionMessage>

          {/* Deep Work Suggestion for High Load */}
          {evaluation.score > 7 && (
            <SectionMessage appearance="warning">
              <MessageTitle>🎯 Recommendation: Deep Work Required</MessageTitle>
              <MessageText>
                This ticket has a high cognitive load (score {evaluation.score}/10). 
                Consider allocating uninterrupted time blocks for focused work. 
                Block your calendar and minimize context switching for optimal productivity.
              </MessageText>
            </SectionMessage>
          )}

          {/* Breakdown by Pillars */}
          {evaluation.breakdown && (
            <BreakdownContainer>
              <BreakdownTitle>📊 Evaluation Breakdown</BreakdownTitle>
              <BreakdownItem>
                <BreakdownLabel>🔍 Ambigüedad (Ambiguity)</BreakdownLabel>
                <BreakdownValue>{evaluation.breakdown.ambiguity}/10 • Weight: 30%</BreakdownValue>
              </BreakdownItem>
              <BreakdownItem>
                <BreakdownLabel>⚙️ Complejidad Técnica (Technical Complexity)</BreakdownLabel>
                <BreakdownValue>{evaluation.breakdown.technicalComplexity}/10 • Weight: 40%</BreakdownValue>
              </BreakdownItem>
              <BreakdownItem>
                <BreakdownLabel>🔄 Context Switching Risk</BreakdownLabel>
                <BreakdownValue>{evaluation.breakdown.contextSwitching}/10 • Weight: 20%</BreakdownValue>
              </BreakdownItem>
              <BreakdownItem>
                <BreakdownLabel>🏚️ Deuda Técnica (Technical Debt)</BreakdownLabel>
                <BreakdownValue>{evaluation.breakdown.technicalDebt}/10 • Weight: 10%</BreakdownValue>
              </BreakdownItem>
            </BreakdownContainer>
          )}
        </>
      )}

      {/* Initial State Message */}
      {!evaluation && !loading && !error && (
        <SectionMessage appearance="info">
          <MessageTitle>👋 Welcome to Jira Pulse</MessageTitle>
          <MessageText>
            Click "Evaluate Ticket Load" to analyze this ticket's cognitive load using AI. 
            The evaluation considers 4 key factors: ambiguity, technical complexity, context switching risk, and technical debt.
          </MessageText>
        </SectionMessage>
      )}
    </Container>
  );
}

export default LoadMonitor;
