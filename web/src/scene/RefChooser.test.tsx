import { describe, test, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RefChooser } from "./RefChooser";

const library = [
  { name: "maya", kind: "character", description: "", imageCount: 1, hasSheet: false, updatedAt: "", cover: null, usedIn: [] },
  { name: "alexandros", kind: "character", description: "", imageCount: 2, hasSheet: true, updatedAt: "", cover: "/x.png", usedIn: [] },
];

describe("RefChooser", () => {
  test("lists items with sheets first, picks one, and disables those without", async () => {
    const onPick = vi.fn();
    render(<RefChooser n={3} library={library} onPick={onPick} onUpload={vi.fn()} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Choose a picture for @image3" })).toBeInTheDocument();
    const options = screen.getAllByRole("button", { name: /@library:/ });
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("alexandros"), expect.stringContaining("maya")]);
    expect(options[1]).toBeDisabled();
    expect(options[1]).toHaveTextContent("no sheet yet");
    fireEvent.click(options[0]);
    expect(onPick).toHaveBeenCalledWith("library:alexandros");
  });

  test("an upload becomes the slot's picture", async () => {
    const onPick = vi.fn();
    const onUpload = vi.fn().mockResolvedValue("file:refs/door.png");
    render(<RefChooser n={1} library={[]} onPick={onPick} onUpload={onUpload} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Upload a picture"), { target: { files: [new File(["x"], "door.png", { type: "image/png" })] } });
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("file:refs/door.png"));
  });

  test("a pasted picture is uploaded the same way", async () => {
    const onPick = vi.fn();
    const onUpload = vi.fn().mockResolvedValue("file:refs/pasted.png");
    render(<RefChooser n={1} library={[]} onPick={onPick} onUpload={onUpload} onClose={() => {}} />);
    const file = new File(["x"], "pasted.png", { type: "image/png" });
    fireEvent.paste(screen.getByRole("dialog"), { clipboardData: { files: [file], items: [] } });
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("file:refs/pasted.png"));
  });

  test("the search box narrows the Library cards", () => {
    render(<RefChooser n={1} library={library} onPick={vi.fn()} onUpload={vi.fn()} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the Library" }), { target: { value: "alex" } });
    expect(screen.getAllByRole("button", { name: /@library:/ })).toHaveLength(1);
  });

  test("Escape closes it and focus goes back to where it was", () => {
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(<RefChooser n={1} library={[]} onPick={vi.fn()} onUpload={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  test("a failed upload says so and picks nothing", async () => {
    const onPick = vi.fn();
    render(<RefChooser n={1} library={[]} onPick={onPick} onUpload={vi.fn().mockRejectedValue(new Error("That is not a picture."))} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Upload a picture"), { target: { files: [new File(["x"], "a.txt", { type: "text/plain" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not a picture.");
    expect(onPick).not.toHaveBeenCalled();
  });
});
