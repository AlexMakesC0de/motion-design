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
  voiceStudioScript: "Hi there.\n[laughter] Okay.",
  voiceStudioTake: null,
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
    expect(screen.getByRole("tab", { name: "Your recording · free" })).toHaveAttribute("aria-selected", "true");
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
    fireEvent.click(screen.getByRole("tab", { name: /ElevenLabs · \$0\.03/ }));
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

  test("VoiceStudio closed: the tab says so, links to it and checks again", async () => {
    let open = false;
    const fetchMock = stub({ "/api/voicestudio": () => ({ running: open, url: "http://127.0.0.1:3900", voices: open ? [{ id: "p-1", name: "Gravel" }] : [] }) });
    render(<VoicePanel asset={base} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "VoiceStudio · free" }));
    expect(await screen.findByText(/VoiceStudio isn't open on this computer/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get VoiceStudio" })).toHaveAttribute("href", expect.stringContaining("debpalash/VoiceStudio"));
    open = true;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("option", { name: "Gravel" })).toBeInTheDocument();
    expect(sent(fetchMock, "/api/voicestudio")).toHaveLength(2);
  });

  test("VoiceStudio open: its script has no mood tags, a take is free, and Keep keeps it", async () => {
    const take = { id: "voicestudio-vera-20261119T102030Z", voice: "p-1", durationS: 21.4, madeAt: "", url: "/media/runs/voices/voicestudio-vera-20261119T102030Z.wav" };
    const fetchMock = stub({
      "/api/voicestudio": () => ({ running: true, url: "http://127.0.0.1:3900", voices: [{ id: "p-1", name: "Gravel" }] }),
      "/api/library/vera/voicestudio": () => ({ ...base, voiceStudioTake: take }),
      "/api/library/vera/keep-voicestudio": () => base,
    });
    const { rerender } = render(<VoicePanel asset={base} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "VoiceStudio · free" }));
    expect(screen.getByLabelText(/Script to read/)).toHaveValue("Hi there.\n[laughter] Okay.");
    await screen.findByRole("option", { name: "Gravel" });
    fireEvent.change(screen.getByRole("combobox", { name: "VoiceStudio voice" }), { target: { value: "p-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Make voice · free" }));
    await waitFor(() => expect(sent(fetchMock, "/api/library/vera/voicestudio")).toHaveLength(1));
    expect(JSON.parse(String((sent(fetchMock, "/api/library/vera/voicestudio")[0][1] as RequestInit).body))).toEqual({ voice: "p-1", script: "Hi there.\n[laughter] Okay." });
    rerender(<VoicePanel asset={{ ...base, voiceStudioTake: take }} onSaved={() => {}} />);
    expect(screen.getByLabelText("The new VoiceStudio take")).toHaveAttribute("src", take.url);
    fireEvent.click(screen.getByRole("button", { name: "Keep this voice" }));
    await waitFor(() => expect(sent(fetchMock, "/api/library/vera/keep-voicestudio")).toHaveLength(1));
  });

  test("with a voice: its card plays, and a new name on the card is saved", async () => {
    const voiced = {
      ...base,
      voice: { durationS: 27.6, origin: "recording" as const, voiceId: null, voiceName: null, script: null, savedAt: "", url: "/media/library/vera/voice.mp3", card: { url: "/media/library/vera/voice-card.mp4", seconds: 28, text: "Vera" } },
      voiceCardName: "Vera",
    };
    const fetchMock = stub({ "/api/library/vera/voice-settings": () => ({ ...voiced, voiceCardName: "V" }) });
    render(<VoicePanel asset={voiced} onSaved={() => {}} />);
    expect(screen.getByLabelText("vera's voice card")).toHaveAttribute("src", "/media/library/vera/voice-card.mp4");
    expect(screen.getByText(/Voice card · 28s/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save name" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name on the card"), { target: { value: "V" } });
    fireEvent.click(save);
    await waitFor(() => expect(sent(fetchMock, "/api/library/vera/voice-settings")).toHaveLength(1));
    expect(JSON.parse(String((sent(fetchMock, "/api/library/vera/voice-settings")[0][1] as RequestInit).body))).toEqual({ cardName: "V" });
  });
});
