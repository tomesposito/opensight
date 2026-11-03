# Moving from QuickSight to OpenSight

A QuickSight bundle carries four kinds of thing: analyses, dashboards, datasets and data sources. OpenSight imports the bundle file directly. Most of a migration is the import itself. The rest is datasets, and this page says exactly where the line falls.

## Step 1: Export and take stock

In Author mode, choose Import .qs or bundle JSON, or drop the file on the import zone. The import opens a new local draft and checkpoints the work you already had open. Before you change anything, read the import report: it names every visual, property and value OpenSight does not support. That list is your migration plan.

## Step 2: What comes across

Every sheet becomes a tab. Bar, line, pie, KPI, table and pivot visuals project into the editor with their dimension and measure columns in place, and the visual type selector works on imported visuals. Calculated fields and parameters show in the Data panel; compatible parameters and a narrow set of simple filters are live and editable.

Export is File, Download .qs. An untouched import exports back with structural JSON equality: unknown properties, original casing inside opaque JSON, member order and layouts all survive. Editing patches only the part you changed.

## Step 3: Remap each dataset

Imported dataset declarations stay unresolved on purpose. OpenSight will not guess that an imported dataset is your local data, and it never connects to an imported data source.

Use Remap to local dataset on a visual, or Remap sheet to local dataset for a whole sheet. Matching ignores case and checks field roles. Wells that match nothing are cleared and the fields that need manual assignment are listed for you.

## Step 4: What you rebuild by hand

- Data connections. The bundle names data sources; it does not carry credentials, and OpenSight does not connect to them. Recreate each connection in OpenSight.
- Anything inside an imported dataset definition: its transformations and its security policies are not executed. Rebuild the preparation in OpenSight's data prep, where it is visible and testable.
- Filters outside the editable set. Other filter configurations stay read-only, and unsupported options are named in the report and block execution until you replace them.
- Visuals OpenSight does not support yet. They stay in place as cards, they stay in the exported bundle, and they render as placeholders until rebuilt.

One more limit, stated plainly: bundles edited in OpenSight carry an `opensightRoundTrip` extension that preserves the original resource. OpenSight makes no claim that AWS accepts that extension back on re-import.

## Step 5: Sizing the job

Do not count dashboards. Count the two numbers in front of you: the datasets you need to recreate connections for, and the unsupported items in the import report. A bundle whose datasets already exist locally and whose report is short is a small job. A bundle leaning on dataset transformations and unsupported filters is a bigger one, and now you know before you start.
