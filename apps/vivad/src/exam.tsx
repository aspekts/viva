import React, { useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import type { ReadStream, WriteStream } from "node:tty";
import type { Answer, Review } from "@viva/contracts";
import { allowsPush } from "@viva/engine";
import type { DaemonClient } from "./client.js";
import { terminalText } from "./terminal-text.js";

export function Exam({ initial, client, finish, fail }: {
  initial: Review; client: DaemonClient; finish: (review: Review | null) => void; fail: (error: unknown) => void;
}) {
  const { exit } = useApp();
  const [review, setReview] = useState(initial);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const question = review.stage === "awaiting-exam" ? review.plan?.questions[answers.length] : undefined;
  const canSkip = review.gate?.skippable !== false && (!review.gate || !allowsPush(review.gate));
  const done = (value: Review | null) => { finish(value); exit(); };

  async function update(action: () => Promise<Review>) {
    setBusy(true);
    try { setReview(await action()); setConfirmSkip(false); }
    catch (error) { fail(error); exit(); }
    finally { setBusy(false); }
  }

  useInput((input, key) => {
    if (key.ctrl && input === "c") return done(null);
    if (busy) return;
    if (key.escape && canSkip) setConfirmSkip((v) => !v);
    if (confirmSkip && input.toLowerCase() === "y") void update(() => client.skip(review.id));
    if (confirmSkip && input.toLowerCase() === "n") setConfirmSkip(false);
    if (!question && !confirmSkip && key.return) done(review);
  });

  function submit(value: string) {
    if (!question || !value.trim() || busy || confirmSkip) return;
    const next: Answer[] = [...answers, { questionId: question.id, transcript: value, mode: "typed" }];
    setAnswers(next);
    setText("");
    if (next.length === review.plan?.questions.length) void update(() => client.answer(review.id, next));
  }

  return <Box flexDirection="column" paddingY={1}>
    <Text bold>Viva · {review.id}</Text>
    {question && <>
      <Text>Question {answers.length + 1}/{review.plan?.questions.length}</Text>
      <Text color="cyan">{terminalText(question.location.file)}:{question.location.lines.join("–")}</Text>
      <Text>{terminalText(question.ask)}</Text>
      {!busy && !confirmSkip && <Box><Text>Answer: </Text><TextInput value={text} onChange={setText} onSubmit={submit} /></Box>}
    </>}
    {busy && <Text>Submitting to the daemon…</Text>}
    {review.gate && <>
      <Text bold color={allowsPush(review.gate) ? "green" : "yellow"}>{review.gate.verdict} ({review.gate.reason})</Text>
      {review.grades.map((g) => <Text key={g.questionId}>{terminalText(g.questionId)}: {g.verdict}{g.missing.length ? ` · missed: ${g.missing.map(terminalText).join(", ")}` : ""}</Text>)}
      {!review.gate.skippable && <Text>Hard gate: cannot skip. Resolve the flagged change and push again.</Text>}
      <Text>Enter to return to git push.</Text>
    </>}
    {canSkip && <Text>{confirmSkip ? "Skip with debt? The push proceeds, but understanding stays unproven. [y/n]" : "Esc: skip with debt"}</Text>}
    <Text dimColor>Ctrl-C: leave exam and block this push</Text>
  </Box>;
}

export async function runExam(review: Review, client: DaemonClient, input: ReadStream, output: WriteStream): Promise<Review | null> {
  let result: Review | null = null;
  let error: unknown;
  let app: ReturnType<typeof render> | undefined;
  try {
    app = render(<Exam initial={review} client={client} finish={(r) => { result = r; }} fail={(e) => { error = e; }} />, {
      stdin: input, stdout: output, stderr: output, exitOnCtrlC: false, patchConsole: false,
    });
    await app.waitUntilExit();
    if (error) throw error;
    return result;
  } finally {
    app?.unmount();
    if (input.isRaw) input.setRawMode(false);
    input.destroy();
  }
}
