import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VoicePanel } from "./VoicePanel";
import { routes } from "../test-fixtures";
import type { AssetDetail } from "../api/types";

const base: AssetDetail = {
  name: "vera", kind: "character", description: "Vera.", keep: null, createdAt: "", updatedAt: "",
  images: [{ n: 1, role: "sheet", file: "1.png", width: 900, height: 600, bytes: 3, mime: "image/png", url: "/media/library/vera/1.png" }],
  usedIn: [], takes: [],
  voice: null,
  voiceSettings: { script: "Hi there.\n[whispers] Shh." },
  voicePrice: { usd: 0.03, basis: "x", chars: 25 },
  voiceJob: null,
  voiceJobKept: false,
};
const voices = { voices: [{ id: "EkK5I93UQWFDigLMpZcX", name: "James", description: "Husky, Engaging and Bold", previewUrl: "https://static.test/james.mp3" }] };

function stub(extra: Record<string, (init?: RequestInit) => unknown> = {}) {
  const fetchMock = vi.fn(routes({ "/api/voices": () => voices, ...extra }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const sent = (fetchMock: ReturnType<typeof stub>, path: string) => fetchMock.mock.calls.filter((c) => String(c[0]) === path);

describe("VoicePanel", () => {
  test("a character with no voice shows the script to read and both ways to get one", async () => {
    stub();
    render(<VoicePanel asset={base} onSaved={() => {}} />);
    expect(screen.getByText(/No voice yet/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Script to read/)).toHaveValue("Hi there.\n[whispers] Shh.");
    expect(screen.getByRole("tab", { name: "Your recording" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Add recording" })).toBeInTheDocument();
  });

  test("a recording is sent as the file itself", async () => {
    const fetchMock = stub({ "/api/library/vera/voice": () => ({ ...base, voice: { durationS: 9.5, origin: "recording", voiceId: null, voiceName: null, script: null, savedAt: "", url: "/media/library/vera/voice.mp3" } }) });
    const onSaved = vi.fn();
    const { container } = render(<VoicePanel asset={base} onSaved={onSaved} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "memo.m4a", { type: "audio/mp4" })] } });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(sent(fetchMock, "/api/library/vera/voice")).toHaveLength(1);
  });

  test("a preset sample saves the picked voice first, then spends, priced on the button", async () => {
    const fetchMock = stub({
      "/api/library/vera/voice-settings": () => ({ ...base, voiceSettings: { ...base.voiceSettings, voiceId: "EkK5I93UQWFDigLMpZcX" } }),
      "/api/library/vera/make-voice": () => base,
    });
    render(<VoicePanel asset={base} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Preset voice" }));
    const make = screen.getByRole("button", { name: /Make voice sample · \$0\.03/ });
    expect(make).toBeDisabled();
    await screen.findByRole("option", { name: /James/ });
    fireEvent.change(screen.getByRole("combobox", { name: "Voice" }), { target: { value: "EkK5I93UQWFDigLMpZcX" } });
    fireEvent.click(make);
    await waitFor(() => expect(sent(fetchMock, "/api/library/vera/make-voice")).toHaveLength(1));
    const patch = sent(fetchMock, "/api/library/vera/voice-settings")[0][1] as RequestInit;
    expect(JSON.parse(String(patch.body))).toMatchObject({ voiceId: "EkK5I93UQWFDigLMpZcX" });
  });

  test("a finished sample plays and is kept with Keep this voice", async () => {
    const job = { id: "j-1", state: "succeeded", media: ["/media/runs/voices/voice-vera.mp3"], updatedAt: "2026-11-19T00:00:00Z" };
    const fetchMock = stub({ "/api/library/vera/adopt-voice": () => base });
    render(<VoicePanel asset={{ ...base, voiceJob: job as never }} onSaved={() => {}} />);
    expect(screen.getByLabelText("The new voice sample")).toHaveAttribute("src", "/media/runs/voices/voice-vera.mp3");
    fireEvent.click(screen.getByRole("button", { name: "Keep this voice" }));
    await waitFor(() => expect(sent(fetchMock, "/api/library/vera/adopt-voice")).toHaveLength(1));
    expect(JSON.parse(String((sent(fetchMock, "/api/library/vera/adopt-voice")[0][1] as RequestInit).body))).toEqual({ job: "j-1" });
  });
});
