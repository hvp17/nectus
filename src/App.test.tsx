import { render, screen } from "@testing-library/react";
import App from "./App";

describe("App", () => {
  it("renders the empty repo state", async () => {
    render(<App />);

    expect(await screen.findByText("Add your first repository")).toBeInTheDocument();
    expect(screen.getByText("Operations")).toBeInTheDocument();
  });
});

