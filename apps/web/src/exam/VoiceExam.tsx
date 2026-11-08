import { useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import type { Question, Review } from "@viva/contracts";
import { ApiError, getVoiceSession } from "../api/client";
import { examinerVariables, knownQuestion } from "./voice";

interface VoiceExamProps {
  review: Review;
  questions: readonly Question[];
  disabled: boolean;
  /** The question the examiner is on, or null when no session is running. */
  onCurrent: (questionId: string | null) => void;
  /** Something the person said while that question was current. */
  onSpoken: (questionId: string, text: string) => void;
}

const voiceErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.status === 503) return "Voice isn't set up on this daemon. Type your answers instead.";
  if (error instanceof DOMException && error.name === "NotAllowedError") return "Microphone access was blocked. Allow it, or type your answers instead.";
  return "Couldn't start the voice exam. Type your answers instead.";
};

/**
 * The ElevenLabs examiner. It talks, the person answers, and what they say streams
 * into the same answer boxes they can type in. Only the transcript is ever graded.
 */
export function VoiceExam(props: VoiceExamProps) {
  return (
    <ConversationProvider>
      <VoiceControls {...props} />
    </ConversationProvider>
  );
}

function VoiceControls({ review, questions, disabled, onCurrent, onSpoken }: VoiceExamProps) {
  const { startSession, endSession, status, isSpeaking } = useConversation();
  const current = useRef<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = status === "connected" || status === "connecting";

  const focus = (id: string | null) => {
    current.current = id;
    onCurrent(id);
  };

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      // Ask for the microphone first, so a refusal is explained here rather than mid-session.
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
      const { signedUrl } = await getVoiceSession();
      focus(questions[0]?.id ?? null);
      startSession({
        signedUrl,
        dynamicVariables: examinerVariables(review, questions),
        clientTools: {
          ask_question: ({ question_id }) => {
            const id = knownQuestion(questions, question_id);
            if (id) focus(id);
            return "ok";
          },
          end_exam: () => {
            // Let the examiner finish its sentence before hanging up.
            setTimeout(() => endSession(), 2500);
            return "ok";
          },
        },
        onMessage: ({ role, message }) => {
          if (role === "user" && current.current) onSpoken(current.current, message);
        },
        onError: () => setError("The voice connection dropped. Your answers so far are kept, so finish by typing."),
        onDisconnect: () => focus(null),
      });
    } catch (e: unknown) {
      setError(voiceErrorMessage(e));
      focus(null);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="voice">
      {live ? (
        <button type="button" onClick={() => endSession()}>
          Stop voice exam
        </button>
      ) : (
        <button type="button" onClick={start} disabled={disabled || starting}>
          {starting ? "Starting…" : "Answer by voice"}
        </button>
      )}
      <span role="status" className="voice-status">
        {status === "connecting" && "Connecting…"}
        {status === "connected" && (isSpeaking ? "Examiner speaking" : "Listening")}
      </span>
      {error && <p role="alert">{error}</p>}
      <small>What you say appears in the answer boxes, so you can fix any mishearing or type instead at any point.</small>
    </div>
  );
}
