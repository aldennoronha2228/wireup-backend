import { describe, expect, it } from "vitest";
import { classifyMongoFailure, maskMongoUri } from "./mongo.js";

describe("mongo diagnostics", () => {
  it("masks the password in the MongoDB URI", () => {
    expect(
      maskMongoUri("mongodb+srv://user:secret-password@cluster0.example.mongodb.net/?appName=WireUp"),
    ).toBe("mongodb+srv://user:***@cluster0.example.mongodb.net/?appName=WireUp");
  });

  it("classifies authentication failures", () => {
    const details = classifyMongoFailure(new Error("Authentication failed for user wireup"));

    expect(details.reason).toBe("Authentication failed");
    expect(details.message).toContain("Authentication failed");
  });

  it("classifies server selection timeouts", () => {
    const error = new Error("Server selection timed out after 30000 ms");
    error.name = "MongoServerSelectionError";

    const details = classifyMongoFailure(error);

    expect(details.reason).toBe("Server selection timeout");
    expect(details.name).toBe("MongoServerSelectionError");
  });
});
