import { describe, test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpendMeter } from "./SpendMeter";

const spend = { capUsd: 10, spentUsd: 2.1, availableUsd: 7.9, perJobUsd: null, unsettled: 0, days: [] };

describe("SpendMeter", () => {
  test("shows spent and cap in the mono face, with an accessible meter", () => {
    render(<SpendMeter spend={spend} />);
    expect(screen.getByText("$2.10 / $10.00")).toHaveClass("mono");
    const meter = screen.getByRole("meter", { name: "Spent today" });
    expect(meter).toHaveAttribute("aria-valuenow", "2.1");
    expect(meter).toHaveAttribute("aria-valuemax", "10");
  });

  test("warns at 80% and over", () => {
    render(<SpendMeter spend={{ ...spend, spentUsd: 8.5, availableUsd: 1.5 }} />);
    expect(screen.getByRole("meter", { name: "Spent today" })).toHaveAttribute("data-level", "high");
  });

  test("shows a dash while loading", () => {
    render(<SpendMeter spend={null} />);
    expect(screen.getByText("— / —")).toBeInTheDocument();
  });
});
