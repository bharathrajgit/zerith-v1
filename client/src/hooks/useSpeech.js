import { useCallback, useEffect, useRef, useState } from 'react';

const SILENCE_TIMEOUT_MS = 3000;
const RECOGNITION_UNSUPPORTED_MESSAGE =
  'Voice input is not supported in this browser. Please use Chrome or Edge.';

const getRecognitionConstructor = () => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

export default function useSpeech() {
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const shouldListenRef = useRef(false);
  const finalTranscriptRef = useRef('');
  const interimTranscriptRef = useRef('');
  const restartTimerRef = useRef(null);

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState(() =>
    getRecognitionConstructor() ? null : RECOGNITION_UNSUPPORTED_MESSAGE
  );

  const RecognitionConstructor = getRecognitionConstructor();
  const isSupported = Boolean(RecognitionConstructor);

  const clearRecognitionTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (restartTimerRef.current) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    clearRecognitionTimers();
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch (recognitionError) {
        if (recognitionError?.name !== 'InvalidStateError') {
          setError('Voice input could not be stopped. Please try again.');
        }
      }
    }
    setIsListening(false);
  }, [clearRecognitionTimers]);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    const Constructor = getRecognitionConstructor();
    if (!Constructor) {
      setError(RECOGNITION_UNSUPPORTED_MESSAGE);
      return;
    }
    if (shouldListenRef.current) return;

    clearRecognitionTimers();
    setError(null);

    let recognition = recognitionRef.current;
    if (!recognition) {
      recognition = new Constructor();
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognitionRef.current = recognition;

      recognition.onresult = (event) => {
        let interim = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const segment = result[0]?.transcript || '';
          if (result.isFinal) {
            finalTranscriptRef.current += `${finalTranscriptRef.current ? ' ' : ''}${segment.trim()}`;
          } else {
            interim += segment;
          }
        }
        interimTranscriptRef.current = interim;
        setTranscript(
          [finalTranscriptRef.current, interim].filter(Boolean).join(' ').trim()
        );

        if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = window.setTimeout(() => {
          shouldListenRef.current = false;
          try {
            recognition.stop();
          } catch (recognitionError) {
            if (recognitionError?.name !== 'InvalidStateError') {
              setError('Voice input stopped unexpectedly. Please try again.');
            }
          }
          setIsListening(false);
        }, SILENCE_TIMEOUT_MS);
      };

      recognition.onerror = (event) => {
        clearRecognitionTimers();
        shouldListenRef.current = false;
        setIsListening(false);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setError('Microphone access was denied. Allow microphone access or type your answer.');
        } else if (event.error === 'audio-capture') {
          setError('No microphone was found. Connect a microphone or type your answer.');
        } else if (event.error === 'no-speech') {
          setError('No speech was detected. Check that your microphone is working, then try again.');
        } else if (event.error === 'network') {
          setError('Speech recognition could not connect. Check your internet connection and try again.');
        } else if (event.error !== 'aborted') {
          setError('Voice input stopped unexpectedly. Please try again.');
        }
      };

      recognition.onend = () => {
        if (!shouldListenRef.current) {
          setIsListening(false);
          return;
        }

        restartTimerRef.current = window.setTimeout(() => {
          if (!shouldListenRef.current) return;
          try {
            recognition.start();
          } catch (recognitionError) {
            shouldListenRef.current = false;
            setIsListening(false);
            if (recognitionError?.name !== 'InvalidStateError') {
              setError('Voice input could not restart. Please try again.');
            }
          }
        }, 100);
      };
    }

    shouldListenRef.current = true;
    setIsListening(true);

    try {
      recognition.start();
    } catch (recognitionError) {
      shouldListenRef.current = false;
      clearRecognitionTimers();
      setIsListening(false);
      setError(
        recognitionError?.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow microphone access or type your answer.'
          : 'Voice input could not start. Please try again.'
      );
    }
  }, [clearRecognitionTimers]);

  const speak = useCallback((text) => {
    if (
      typeof window === 'undefined' ||
      !window.speechSynthesis ||
      typeof window.SpeechSynthesisUtterance !== 'function' ||
      typeof text !== 'string' ||
      !text.trim()
    ) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new window.SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice =
      voices.find((voice) => voice.lang === 'en-US' && voice.name.includes('Female')) ||
      voices.find((voice) => voice.lang === 'en-US') ||
      null;
    utterance.lang = 'en-US';
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => {
      setIsSpeaking(false);
      setError('Coach audio could not be played. You can continue in text mode.');
    };
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  useEffect(() => () => {
    shouldListenRef.current = false;
    clearRecognitionTimers();
    if (recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onend = null;
      try {
        recognitionRef.current.stop();
      } catch (recognitionError) {
        if (recognitionError?.name !== 'InvalidStateError') {
          console.error('Unable to stop speech recognition during cleanup:', recognitionError);
        }
      }
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, [clearRecognitionTimers]);

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    isSpeaking,
    isSupported,
    error,
  };
}
