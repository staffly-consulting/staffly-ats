/**
 * Round-trip check for the criteria contract.
 *
 * Run: npx tsx scripts/criteria-roundtrip.test.ts
 *
 * This exercises the pieces that the AI scoring step will depend on:
 * validation, the exact JSON persisted into the two `Json` columns, and the
 * parse back out — including the Step 2 shapes that already exist in the wild.
 * Nothing here touches the database; it is pure and fast on purpose.
 */
import {
  describeCriterion,
  readMandatoryCriteria,
  readOptionalCriteria,
  writeMandatoryCriteria,
  writeOptionalCriteria,
} from "../src/lib/criteria";
import {
  jobPostFormSchema,
  type JobPostFormValues,
} from "../src/lib/validations/job-post";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}`, detail ?? "");
  }
}

const valid: JobPostFormValues = {
  title: "Senior Frontend Engineer",
  description: "Own the recruiter workspace.",
  status: "OPEN",
  mandatoryCriteria: [
    {
      id: "m1",
      type: "years_experience",
      label: "React engineering",
      minYears: 3,
      weight: 10,
    },
    {
      id: "m2",
      type: "education_level",
      label: "CS or related",
      value: "bachelors",
      weight: 10,
    },
  ],
  optionalCriteria: [
    {
      id: "o1",
      type: "skill",
      label: "Comfortable in TypeScript",
      value: "TypeScript",
      weight: 7,
    },
    {
      id: "o2",
      type: "skill",
      label: "Has run infra",
      value: "AWS",
      weight: 4,
    },
  ],
  referralPriorityEnabled: true,
  referralBonusWeight: 5,
  preferredUniversityIds: ["uni_1", "uni_2"],
};

console.log("\n--- validation: accepts a well-formed post ---");
const parsed = jobPostFormSchema.safeParse(valid);
check(
  "valid payload parses",
  parsed.success,
  parsed.success ? "" : parsed.error.issues,
);

console.log("\n--- validation: rejects what it should ---");
const reject = (
  name: string,
  mutate: (v: typeof valid) => unknown,
  expectPath: string,
) => {
  const result = jobPostFormSchema.safeParse(mutate(structuredClone(valid)));
  const paths = result.success
    ? []
    : result.error.issues.map((i) => i.path.join("."));
  check(
    `${name} (expects issue at ${expectPath})`,
    !result.success && paths.some((p) => p === expectPath),
    paths,
  );
};

reject(
  "no mandatory criteria",
  (v) => ({ ...v, mandatoryCriteria: [] }),
  "mandatoryCriteria",
);
reject(
  "duplicate skill in optional",
  (v) => {
    v.optionalCriteria.push({ ...v.optionalCriteria[0], id: "o3" });
    return v;
  },
  "optionalCriteria.2.label",
);
reject(
  "same criterion mandatory AND optional",
  (v) => {
    v.optionalCriteria.push({
      id: "o9",
      type: "education_level",
      label: "dup",
      value: "bachelors",
      weight: 3,
    });
    return v;
  },
  "optionalCriteria.2.label",
);
reject(
  "years_experience with no minYears",
  (v) => {
    delete (v.mandatoryCriteria[0] as { minYears?: number }).minYears;
    return v;
  },
  "mandatoryCriteria.0.minYears",
);
reject(
  "skill with no value",
  (v) => {
    delete (v.optionalCriteria[0] as { value?: string }).value;
    return v;
  },
  "optionalCriteria.0.value",
);
reject(
  "education_level with a bogus level",
  (v) => {
    v.mandatoryCriteria[1].value = "doctorate-ish";
    return v;
  },
  "mandatoryCriteria.1.value",
);
reject(
  "weight above 10",
  (v) => {
    v.optionalCriteria[0].weight = 99;
    return v;
  },
  "optionalCriteria.0.weight",
);
reject(
  "referral enabled with zero bonus",
  (v) => ({ ...v, referralBonusWeight: 0 }),
  "referralBonusWeight",
);

console.log("\n--- case-insensitive duplicate detection ---");
const dupCase = structuredClone(valid);
dupCase.optionalCriteria.push({
  id: "o4",
  type: "skill",
  label: "typescript again",
  value: "  typescript  ",
  weight: 2,
});
check(
  "'  typescript  ' collides with 'TypeScript'",
  !jobPostFormSchema.safeParse(dupCase).success,
);

console.log("\n--- serialization round-trip ---");
const storedMandatory = writeMandatoryCriteria(valid.mandatoryCriteria);
const storedOptional = writeOptionalCriteria(
  valid.optionalCriteria,
  valid.preferredUniversityIds,
);

const backMandatory = readMandatoryCriteria(
  JSON.parse(JSON.stringify(storedMandatory)),
);
const backOptional = readOptionalCriteria(
  JSON.parse(JSON.stringify(storedOptional)),
);

check(
  "mandatory survives round-trip",
  backMandatory.length === 2 && backMandatory[0].minYears === 3,
);
check("optional survives round-trip", backOptional.criteria.length === 2);
check(
  "preferred university ids survive",
  backOptional.preferredUniversityIds.join(",") === "uni_1,uni_2",
);
check(
  "stale minYears is not persisted on a skill",
  !("minYears" in storedOptional.criteria[0]),
  storedOptional.criteria[0],
);
check(
  "education_level keeps its value, drops minYears",
  storedMandatory[1].value === "bachelors" &&
    !("minYears" in storedMandatory[1]),
);

console.log("\n--- backward compatibility with Step 2 rows ---");
const legacyMandatory = [
  {
    id: "c_be_1",
    label: "5+ years backend TypeScript",
    type: "mandatory",
    weight: 30,
  },
];
const legacyOptional = [
  { id: "c_be_3", label: "Distributed systems", type: "optional", weight: 20 },
];
const legacyRead = readMandatoryCriteria(legacyMandatory);
const legacyOptRead = readOptionalCriteria(legacyOptional);
check("legacy mandatory row still readable", legacyRead.length === 1);
check(
  "legacy 'mandatory' type becomes 'custom'",
  legacyRead[0]?.type === "custom",
);
check(
  "legacy label preserved",
  legacyRead[0]?.label === "5+ years backend TypeScript",
);
check(
  "legacy weight clamped into 1-10",
  legacyRead[0]?.weight === 10,
  legacyRead[0]?.weight,
);
check(
  "legacy bare-array optional still readable",
  legacyOptRead.criteria.length === 1,
);
check(
  "legacy optional has no universities",
  legacyOptRead.preferredUniversityIds.length === 0,
);

console.log("\n--- garbage tolerance ---");
check("null column", readMandatoryCriteria(null).length === 0);
check("string column", readMandatoryCriteria("nonsense" as never).length === 0);
check(
  "array of junk",
  readMandatoryCriteria([1, "x", null, {}] as never).length === 0,
);
check(
  "mixed valid + junk keeps the valid one",
  readMandatoryCriteria([
    { label: "keep me", type: "skill", weight: 3 },
    null,
  ] as never).length === 1,
);

console.log("\n--- human-readable rendering (feeds the AI prompt) ---");
for (const criterion of [...backMandatory, ...backOptional.criteria]) {
  console.log(`  • ${describeCriterion(criterion)}`);
}

console.log("\n--- PERSISTED SHAPE ---");
console.log("mandatoryCriteria =", JSON.stringify(storedMandatory, null, 2));
console.log("optionalCriteria  =", JSON.stringify(storedOptional, null, 2));

console.log(
  failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
