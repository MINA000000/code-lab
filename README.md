# Code Lab

A website where students solve Python and JavaScript tasks in the browser and get
instant pass/fail results. Only email addresses you add to the class list can use it.

- **Students:** log in, open a task, write code, press **Run** to try it, then **Submit** to check it against the tests.
- **Teacher** (`teacher.html`): create tasks and tests, manage the class list, and see each student's best score and latest code.

Code runs inside each student's browser: Python through [Pyodide](https://pyodide.org) and
JavaScript in a Web Worker. That's why there's no code server to pay for.
Logins and data live in [Supabase](https://supabase.com) (free tier).

## Setup (about 15 minutes)

### 1. Create the database

1. Sign up at <https://supabase.com> and create a **new project** (free plan). Choose a region close to your students.
2. Open `supabase/schema.sql`. At the bottom, replace `YOUR-EMAIL@example.com` with the email **you** will log in with.
3. In Supabase, go to **SQL Editor → New query**, paste the whole file and click **Run**.
4. Go to **Authentication → Sign In / Providers → Email** and turn **off** “Confirm email”.
   Supabase's free email service only sends a few emails per hour, so a whole class signing up
   at once would get stuck. The class list already blocks strangers.

### 2. Connect the website

In Supabase, open **Project Settings → API** (or click **Connect**) and copy the **Project URL** and the **anon / public key**
into `config.js`:

```js
SUPABASE_URL: "https://abcdefgh.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...",
```

You can also change `SITE_NAME` there.

### 3. Put it online (free)

The site is hosted on **Cloudflare Pages** at <https://mina-code-lab.pages.dev>.
(Netlify's `*.netlify.app` addresses can't be reached from our internet connection, so we don't use Netlify.)

To publish changes after editing the files:

```bash
mkdir -p /tmp/site && cp -r index.html teacher.html config.js css js /tmp/site/
npx wrangler@4.40.0 pages deploy /tmp/site --project-name mina-code-lab --branch main
```

In Supabase, **Authentication → URL Configuration** must have **Site URL** set to
`https://mina-code-lab.pages.dev`. Password-reset emails need it.

### 4. First login

Open the site, click **“New here? Create account”**, and sign up with the teacher email
from step 1. You'll see a **Teacher dashboard** button.

## Daily use

- **Add students:** Teacher dashboard → **Students**. Add one at a time, or paste a list
  (`email, name` per line). Tell students to open the site and click “Create account” with that email.
- **Remove a student:** click **Remove**. They lose access immediately.
- **Create a task:** **Tasks → New task**. Add tests:
  - **Check a value:** code that runs after the student's code.
    - Python: `assert add(2, 3) == 5`. When it fails, the student sees the expected and actual values.
    - JavaScript: `assertEqual(add(2, 3), 5);` or `assert(isEven(4), "4 is even");`
  - **Check printed output:** give the input lines (fed to `input()`) and the exact expected output.
    Extra spaces at line ends are ignored. In tests, `input("prompt")` doesn't print its prompt, so
    expected output contains only what the program prints.
  - Paste a correct solution under **Try your tests** to make sure your tests are right before you publish.
- **Chapters:** in the **Chapters** tab, add chapters and set their order. Pick a chapter when you create or edit
  a task, or when you upload a PDF. Students see two tabs (Coding tasks / Materials) grouped by chapter, and
  **Results** shows each student's % per chapter (click a chapter for per-task detail).
  Deleting a chapter keeps its tasks and PDFs; they move to "Other".
- **Share PDFs:** go to **Materials**, enter a title, choose a PDF (max 50 MB) and click **Upload**.
  Students see it under their tasks with **Open** and **Download** buttons. Files are private to your class list.
  The free plan gives 1 GB of storage and about 5 GB of downloads a month, so compress big scanned PDFs first.
- **Show or hide a task:** use the **Visible to students** switch.
- **Quizzes:** in the **Quizzes** tab, add a quiz (title, full mark, date, chapter), then click **Marks** and type each
  student's mark (leave a box empty if they were absent; Enter jumps to the next student). Students see only their own
  marks in **Quiz results**. **Top students** shows the top 3 by total points (all marks on visible quizzes added up;
  ties share a place) plus each student's own place. Hiding a quiz removes it from both. The Quizzes tab also shows you
  the full class ranking.
- **Add or remove points:** in **Quizzes → Add or remove points**, choose Add or Remove, pick a student, enter points and a reason. They're added to the
  student's total for the Top 3 (a minus number takes points away). Each student sees their own extra points in Quiz results.
- **Levels:** in **Quizzes → Levels**, set each level's name, minimum points and colour (like Codeforces ranks).
  A student's name is coloured by the highest level their total points reach. Students see the level list under
  Top students, and how many points they need for the next level in Quiz results.
- **Results:** a grid of students × tasks. Click a cell to see that student's latest code.
- **Student forgot their password:** they can click “Forgot password?”. Or, in Supabase →
  **Authentication → Users**, delete their user. They then sign up again (their old submissions are deleted too).

## Limits to know about

- **Tests run on the student's computer.** A determined student could open the browser tools, read
  the tests, or send a fake “passed” result. This is fine for practice and homework. For graded exams,
  check the submitted code in **Results** yourself, or later add a server-side runner such as Judge0.
- Each run has a **5-second time limit**, so infinite loops get stopped.
- The first Python run on a device downloads Pyodide (about 10 MB, a few seconds). After that, the browser caches it.
- Python packages that ship with Pyodide (numpy, pandas, …) load automatically on `import`.
  The first load can take longer than the time limit.
- **The free Supabase plan pauses a project after 7 days without use.** Click “Restore” in the dashboard
  if that happens. Pro costs $25/month and never pauses.

## Cost

| Item | Cost |
|---|---|
| Supabase Free (500 MB database, 50,000 monthly users) | $0 |
| Hosting on Netlify / Cloudflare Pages / GitHub Pages | $0 |
| Your own domain (optional) | ~$10–15 / year |

## Files

```
index.html          student page (login, task list, editor)
teacher.html        teacher dashboard
config.js           your Supabase keys
css/style.css
js/common.js        shared helpers (Supabase client, editor, result rendering)
js/app.js           student page logic
js/teacher.js       teacher dashboard logic
js/runner.js        runs code in workers, time limits, grading
js/py-worker.js     Python runner (Pyodide)
js/js-worker.js     JavaScript runner
supabase/schema.sql database tables + security rules (run once)
```
