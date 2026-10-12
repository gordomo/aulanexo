import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { pool, migrate, write, rows } from "../src/db/index.js";
import { passwordHash } from "../src/security.js";
import { generateCharges, reminders } from "../src/jobs.js";
import { today, nextBillingMonth } from "../src/domain.js";
const enabled = process.env.RUN_INTEGRATION === "1";
test(
  "real MySQL: authenticated flows, tenant isolation, fees, attendance and payments",
  { skip: !enabled },
  async (t) => {
    if (process.env.DB_NAME !== "aulanexo_test")
      throw new Error("Integration tests require the isolated test database");
    await migrate();
    const app = createApp(async () => {
      await pool.query("SELECT 1");
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    t.after(async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await pool.end();
    });
    const suffix = randomBytes(6).toString("hex"),
      password = "Test-password-12345";
    const hash = await passwordHash(password);
    const owner = (
      await write(
        "INSERT INTO users(email,name,password_hash,super_admin) VALUES (?,?,?,1)",
        [`owner-${suffix}@test.local`, "Owner", hash],
      )
    ).insertId;
    const admin = (
      await write(
        "INSERT INTO users(email,name,password_hash) VALUES (?,?,?)",
        [`admin-${suffix}@test.local`, "Admin", hash],
      )
    ).insertId;
    const student = (
      await write(
        "INSERT INTO users(email,name,password_hash) VALUES (?,?,?)",
        [`student-${suffix}@test.local`, "Student", hash],
      )
    ).insertId;
    const teacher = (
      await write(
        "INSERT INTO users(email,name,password_hash) VALUES (?,?,?)",
        [`teacher-${suffix}@test.local`, "Teacher", hash],
      )
    ).insertId;
    const settings = JSON.stringify({
      dueDay: 10,
      enrollmentEnabled: true,
      discountPercent: 0,
      paymentMethods: ["Efectivo"],
      automaticReminders: true,
    });
    async function tenant(name: string) {
      return (
        await write(
          "INSERT INTO institutes(name,slug,contact_email,monthly_cents,settings) VALUES (?,?,?,?,?)",
          [
            name,
            `${name.toLowerCase()}-${suffix}`,
            "contact@test.local",
            10000,
            settings,
          ],
        )
      ).insertId;
    }
    const a = await tenant("Alpha"),
      b = await tenant("Beta");
    for (const [tid, uid, role] of [
      [a, admin, "admin"],
      [b, owner, "admin"],
      [a, student, "student"],
      [a, teacher, "teacher"],
    ] as const)
      await write(
        "INSERT INTO memberships(institute_id,user_id,role,status) VALUES (?,?,?,'approved')",
        [tid, uid, role],
      );
    const sid = (
      await write(
        "INSERT INTO people(institute_id,user_id,kind,first_name,last_name,email) VALUES (?,?,'student','Ana','Alumno',?)",
        [a, student, `student-${suffix}@test.local`],
      )
    ).insertId;
    const teacherPerson = (
      await write(
        "INSERT INTO people(institute_id,user_id,kind,first_name,last_name) VALUES (?,?,'teacher','Ana','Profesor')",
        [a, teacher],
      )
    ).insertId;
    const foreignPerson = (
      await write(
        "INSERT INTO people(institute_id,kind,first_name,last_name) VALUES (?,'student','Foreign','Student')",
        [b],
      )
    ).insertId;
    const course = (
      await write(
        "INSERT INTO courses(institute_id,name,level) VALUES (?,'English','A1')",
        [a],
      )
    ).insertId;
    const day = today(),
      year = Number(day.slice(0, 4));
    async function commission(name: string, capacity = 1) {
      return (
        await write(
          "INSERT INTO commissions(institute_id,course_id,name,academic_year,start_date,end_date,schedule,modality,capacity,monthly_cents,enrollment_cents) VALUES (?,?,?,?,?,?,'Monday 18:00','presencial',?,10001,5000)",
          [
            a,
            course,
            name,
            year,
            `${year}-01-01`,
            `${year + 1}-12-31`,
            capacity,
          ],
        )
      ).insertId;
    }
    const c1 = await commission("First"),
      c2 = await commission("Second");
    await write(
      "INSERT INTO teaching(institute_id,person_id,commission_id) VALUES (?,?,?)",
      [a, teacherPerson, c1],
    );
    async function login(uid: number) {
      const agent = request.agent(server);
      const address = (
        await rows("SELECT email FROM users WHERE id=?", [uid])
      )[0].email;
      let response = await agent.get("/login");
      const token = /name="_csrf" value="([a-f0-9]+)"/.exec(response.text)![1];
      response = await agent
        .post("/login")
        .type("form")
        .send({ _csrf: token, email: address, password });
      assert.equal(response.status, 302);
      return agent;
    }
    await t.test(
      "superadministrator login opens the platform panel",
      async () => {
        const agent = request.agent(server);
        const response = await agent.get("/login");
        const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(response.text)![1];
        const signed = await agent
          .post("/login")
          .type("form")
          .send({ _csrf: csrf, email: `owner-${suffix}@test.local`, password });
        assert.equal(signed.status, 302);
        assert.equal(signed.headers.location, "/platform");
      },
    );
    const aa = await login(admin),
      ss = await login(student),
      tt = await login(teacher),
      oo = await login(owner);
    async function post(agent: any, url: string, data: any = {}) {
      const response = await agent.get("/institutes");
      const token = /name="_csrf" value="([a-f0-9]+)"/.exec(response.text)![1];
      return agent
        .post(url)
        .type("form")
        .send({ _csrf: token, ...data });
    }
    await t.test(
      "tenant authorization and CSRF are enforced on direct requests",
      async () => {
        assert.equal((await aa.get(`/i/${b}`)).status, 403);
        assert.equal((await ss.get(`/i/${a}/users`)).status, 403);
        assert.equal((await aa.get("/platform")).status, 403);
        assert.equal((await oo.get("/platform")).status, 200);
        assert.equal(
          (
            await aa
              .post(`/i/${a}/courses/new`)
              .type("form")
              .send({ name: "Bad", level: "B2" })
          ).status,
          403,
        );
        const response = await post(aa, `/i/${a}/commissions/${c1}/enroll`, {
          person_id: foreignPerson,
          discount: 0,
        });
        assert.equal(response.status, 400);
        await assert.rejects(() =>
          write(
            "INSERT INTO enrollments(institute_id,person_id,commission_id,billing_start) VALUES (?,?,?,?)",
            [a, foreignPerson, c1, day],
          ),
        );
      },
    );
    await t.test(
      "registration requires approval and links existing account without replacing its password",
      async () => {
        const response = await ss.get(`/register/beta-${suffix}`);
        const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(response.text)![1];
        assert.equal(
          (
            await ss
              .post(`/register/beta-${suffix}`)
              .type("form")
              .send({
                _csrf: csrf,
                name: "Student",
                email: `student-${suffix}@test.local`,
                password,
                role: "student",
              })
          ).status,
          200,
        );
        assert.equal((await ss.get(`/i/${b}`)).status, 403);
        const m = (
          await rows(
            "SELECT id FROM memberships WHERE institute_id=? AND user_id=?",
            [b, student],
          )
        )[0];
        assert.equal(
          (
            await post(oo, `/i/${b}/users/${m.id}`, {
              role: "student",
              status: "approved",
            })
          ).status,
          302,
        );
        assert.equal((await ss.get(`/i/${b}`)).status, 200);
      },
    );
    await t.test("the last administrator cannot be disabled", async () => {
      const m = (
        await rows(
          "SELECT id FROM memberships WHERE institute_id=? AND user_id=?",
          [a, admin],
        )
      )[0];
      assert.equal(
        (
          await post(aa, `/i/${a}/users/${m.id}`, {
            role: "student",
            status: "inactive",
          })
        ).status,
        400,
      );
    });
    await t.test(
      "duplicate enrollment and capacity are protected with a locked commission",
      async () => {
        assert.equal(
          (
            await post(aa, `/i/${a}/commissions/${c1}/enroll`, {
              person_id: sid,
              discount: 10,
            })
          ).status,
          302,
        );
        assert.equal(
          (
            await post(aa, `/i/${a}/commissions/${c1}/enroll`, {
              person_id: sid,
              discount: 0,
            })
          ).status,
          400,
        );
        const another = (
          await write(
            "INSERT INTO people(institute_id,kind,first_name,last_name) VALUES (?,'student','Other','Student')",
            [a],
          )
        ).insertId;
        assert.equal(
          (
            await post(aa, `/i/${a}/commissions/${c1}/enroll`, {
              person_id: another,
              discount: 0,
            })
          ).status,
          400,
        );
        const e = (
          await rows(
            "SELECT billing_start FROM enrollments WHERE institute_id=? AND person_id=?",
            [a, sid],
          )
        )[0];
        assert.equal(e.billing_start, nextBillingMonth(day));
        assert.equal((await ss.get(`/i/${a}/commissions/${c1}`)).status, 200);
        assert.equal((await ss.get(`/i/${a}/commissions/${c2}`)).status, 400);
      },
    );
    await t.test(
      "teacher scope and multiple lesson instances in one day",
      async () => {
        assert.equal((await tt.get(`/i/${a}/commissions/${c2}`)).status, 400);
        assert.equal(
          (
            await post(tt, `/i/${a}/attendance/new`, {
              commission: c2,
              day,
              time: "10:00",
            })
          ).status,
          400,
        );
        for (const time of ["10:00", "12:00"])
          assert.equal(
            (
              await post(tt, `/i/${a}/attendance/new`, {
                commission: c1,
                day,
                time,
              })
            ).status,
            302,
          );
        const lesson = (
          await rows(
            "SELECT id FROM lessons WHERE institute_id=? ORDER BY id LIMIT 1",
            [a],
          )
        )[0].id;
        assert.equal(
          (
            await post(tt, `/i/${a}/attendance/${lesson}`, {
              [`attendance_${sid}`]: "present",
              [`attendance_${foreignPerson}`]: "absent",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post(tt, `/i/${a}/attendance/${lesson}`, {
              [`attendance_${sid}`]: "present",
            })
          ).status,
          302,
        );
        assert.equal(
          (
            await post(ss, `/i/${a}/attendance/${lesson}`, {
              [`attendance_${sid}`]: "absent",
            })
          ).status,
          403,
        );
        assert.match(
          (await ss.get(`/i/${a}/attendance/${lesson}`)).text,
          /Presente/,
        );
      },
    );
    await t.test(
      "payment is atomic, full and cannot be repeated; receipts are scoped",
      async () => {
        const charge = (
          await rows(
            "SELECT id FROM charges WHERE institute_id=? AND person_id=? AND kind='enrollment'",
            [a, sid],
          )
        )[0].id;
        assert.equal(
          (
            await post(aa, `/i/${a}/payments/${charge}/pay`, {
              method: "Efectivo",
              paid_date: day,
              reference: "test",
            })
          ).status,
          302,
        );
        assert.equal(
          (
            await post(aa, `/i/${a}/payments/${charge}/pay`, {
              method: "Efectivo",
              paid_date: day,
            })
          ).status,
          400,
        );
        const payment = (
          await rows(
            "SELECT id FROM payments WHERE institute_id=? AND charge_id=?",
            [a, charge],
          )
        )[0].id;
        assert.equal(
          (await ss.get(`/i/${a}/payments/receipts/${payment}`)).status,
          200,
        );
        assert.equal(
          (await oo.get(`/i/${b}/payments/receipts/${payment}`)).status,
          404,
        );
        assert.equal(
          (
            await rows(
              "SELECT COUNT(*) AS total FROM payments WHERE charge_id=?",
              [charge],
            )
          )[0].total,
          1,
        );
      },
    );
    await t.test(
      "forgiveness requires reason and prevents later payment",
      async () => {
        const charge = (
          await write(
            "INSERT INTO charges(institute_id,person_id,kind,description,cents,due_date) VALUES (?,?,'manual','Manual',12345,?)",
            [a, sid, day],
          )
        ).insertId;
        assert.equal(
          (
            await post(aa, `/i/${a}/payments/${charge}/forgive`, {
              reason: " ",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post(aa, `/i/${a}/payments/${charge}/forgive`, {
              reason: "Acuerdo con la familia",
            })
          ).status,
          302,
        );
        assert.equal(
          (
            await post(aa, `/i/${a}/payments/${charge}/pay`, {
              method: "Efectivo",
              paid_date: day,
            })
          ).status,
          400,
        );
        const c = (await rows("SELECT * FROM charges WHERE id=?", [charge]))[0];
        assert.equal(c.forgiveness_reason, "Acuerdo con la familia");
        assert.equal(c.status, "forgiven");
      },
    );
    await t.test(
      "monthly fee and platform billing generation are idempotent",
      async () => {
        await write(
          "UPDATE enrollments SET billing_start=? WHERE institute_id=?",
          [day.slice(0, 7) + "-01", a],
        );
        await generateCharges();
        await generateCharges();
        const charges = await rows(
          "SELECT cents FROM charges WHERE institute_id=? AND kind='monthly' AND period=?",
          [a, day.slice(0, 7)],
        );
        assert.equal(charges.length, 1);
        assert.equal(Number(charges[0].cents), 9001);
        assert.equal(
          (
            await rows(
              "SELECT COUNT(*) AS total FROM platform_charges WHERE institute_id=? AND period=?",
              [a, day.slice(0, 7)],
            )
          )[0].total,
          1,
        );
      },
    );
    await t.test(
      "notifications reject cross-institute recipients and expose only intended messages",
      async () => {
        assert.equal(
          (
            await post(aa, `/i/${a}/notifications/new`, {
              title: "Secret",
              body: "Private",
              audience: "user",
              user_id: owner,
              send_email: "no",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post(aa, `/i/${a}/notifications/new`, {
              title: "Student update",
              body: "Only student",
              audience: "user",
              user_id: student,
              send_email: "yes",
            })
          ).status,
          302,
        );
        const n = (
          await rows(
            "SELECT id FROM notifications WHERE institute_id=? AND title='Student update'",
            [a],
          )
        )[0].id;
        assert.equal((await ss.get(`/i/${a}/notifications/${n}`)).status, 200);
        assert.equal((await tt.get(`/i/${a}/notifications/${n}`)).status, 404);
      },
    );
    await t.test(
      "manual contains only relevant actions for each role",
      async () => {
        const studentHelp = await ss.get(`/i/${a}/help`);
        assert.equal(studentHelp.status, 200);
        assert.match(studentHelp.text, /Consultar tus pagos/);
        assert.doesNotMatch(
          studentHelp.text,
          /Aprobar solicitudes y administrar roles/,
        );
        assert.match((await aa.get(`/i/${a}/help`)).text, /Condonar/);
      },
    );
    await t.test("logout invalidates the server session", async () => {
      assert.equal((await post(ss, "/logout")).status, 302);
      assert.equal((await ss.get(`/i/${a}`)).status, 302);
    });
    await t.test(
      "platform creation invites the first admin with a single-use link",
      async () => {
        const response = await post(oo, "/platform/new", {
          name: "Invited Institute",
          slug: `invited-${suffix}`,
          contact_email: "contact@test.local",
          admin_email: `owner-${suffix}@test.local`,
          phone: "",
          plan: "Demo",
          monthly: "100.00",
          due_day: "10",
        });
        assert.equal(response.status, 302);
        const created = (
          await rows("SELECT id FROM institutes WHERE slug=?", [
            `invited-${suffix}`,
          ])
        )[0];
        const message = (
          await rows(
            "SELECT body FROM outbox WHERE recipient=? AND subject LIKE 'Invitación%' ORDER BY id DESC LIMIT 1",
            [`owner-${suffix}@test.local`],
          )
        )[0].body;
        const invite = /\/invite\/([a-f0-9]{64})/.exec(message)![1];
        assert.equal((await oo.get(`/invite/${invite}`)).status, 200);
        assert.equal(
          (await post(oo, `/invite/${invite}`, { name: "Owner", password }))
            .status,
          302,
        );
        assert.equal((await oo.get(`/i/${created.id}`)).status, 200);
        assert.equal(
          (await post(oo, `/invite/${invite}`, { name: "Owner", password }))
            .status,
          400,
        );
        assert.equal((await oo.get("/platform/help")).status, 200);
        assert.equal(
          (
            await post(oo, `/platform/${created.id}/charges/new`, {
              description: "Extra",
              amount: "12.34",
              due_date: day,
            })
          ).status,
          302,
        );
        const charge = (
          await rows(
            "SELECT id FROM platform_charges WHERE institute_id=? AND description='Extra'",
            [created.id],
          )
        )[0].id;
        assert.equal(
          (
            await post(oo, `/platform/${created.id}/charges/${charge}/pay`, {
              method: "Transferencia",
              paid_date: day,
            })
          ).status,
          302,
        );
        assert.equal(
          (
            await post(oo, `/platform/${created.id}/charges/${charge}/pay`, {
              method: "Transferencia",
              paid_date: day,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "password recovery rotates password and invalidates existing sessions",
      async () => {
        const stillLogged = await login(student);
        const agent = request.agent(server);
        const response = await agent.get("/forgot");
        const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(response.text)![1];
        assert.equal(
          (
            await agent
              .post("/forgot")
              .type("form")
              .send({ _csrf: csrf, email: `student-${suffix}@test.local` })
          ).status,
          200,
        );
        const message = (
          await rows(
            "SELECT body FROM outbox WHERE recipient=? AND subject LIKE 'Recuperá%' ORDER BY id DESC LIMIT 1",
            [`student-${suffix}@test.local`],
          )
        )[0].body;
        const reset = /\/reset\/([a-f0-9]{64})/.exec(message)![1];
        const newPassword = "New-test-password-98765";
        assert.equal(
          (
            await agent
              .post(`/reset/${reset}`)
              .type("form")
              .send({ _csrf: csrf, password: newPassword })
          ).status,
          302,
        );
        assert.equal((await stillLogged.get(`/i/${a}`)).status, 302);
        assert.equal(
          (
            await agent
              .post(`/reset/${reset}`)
              .type("form")
              .send({ _csrf: csrf, password: newPassword })
          ).status,
          400,
        );
        const loginPage = await agent.get("/login");
        const newCsrf = /name="_csrf" value="([a-f0-9]+)"/.exec(
          loginPage.text,
        )![1];
        assert.equal(
          (
            await agent
              .post("/login")
              .type("form")
              .send({
                _csrf: newCsrf,
                email: `student-${suffix}@test.local`,
                password: newPassword,
              })
          ).status,
          302,
        );
      },
    );
    await t.test(
      "automatic reminders are emitted once per scheduled day",
      async () => {
        const yesterday = new Date(Date.parse(day) - 86400000)
          .toISOString()
          .slice(0, 10);
        const charge = (
          await write(
            "INSERT INTO charges(institute_id,person_id,kind,description,cents,due_date) VALUES (?,?,'manual','Overdue',1000,?)",
            [a, sid, yesterday],
          )
        ).insertId;
        await reminders();
        await reminders();
        assert.equal(
          (
            await rows(
              "SELECT COUNT(*) AS total FROM outbox WHERE dedupe_key=?",
              [`debt:${charge}:${day}`],
            )
          )[0].total,
          1,
        );
      },
    );
    await t.test(
      "minimal person records can be completed and logically deactivated without losing history",
      async () => {
        assert.equal(
          (
            await post(aa, `/i/${a}/people/student/new`, {
              first_name: "Minimal",
              last_name: "Record",
            })
          ).status,
          302,
        );
        const person = (
          await rows(
            "SELECT id FROM people WHERE institute_id=? AND first_name='Minimal'",
            [a],
          )
        )[0].id;
        assert.equal(
          (await aa.get(`/i/${a}/people/student/${person}/edit`)).status,
          200,
        );
        assert.equal(
          (
            await post(aa, `/i/${a}/people/student/${person}/edit`, {
              first_name: "<script>alert(1)</script>",
              last_name: "Record",
              dni: "12345678",
              email: "minimal@test.local",
              birth_date: "2000-01-01",
              address: "Address",
            })
          ).status,
          302,
        );
        const list = await aa.get(`/i/${a}/people/student`);
        assert.equal(list.status, 200);
        assert.ok(!list.text.includes("<script>alert(1)</script>"));
        assert.match(list.text, /&lt;script&gt;/);
        assert.equal(
          (await post(aa, `/i/${a}/people/student/${person}/toggle`)).status,
          302,
        );
        assert.equal(
          (
            await rows(
              "SELECT active FROM people WHERE institute_id=? AND id=?",
              [a, person],
            )
          )[0].active,
          0,
        );
        assert.equal(
          (await post(aa, `/i/${a}/people/student/${person}/toggle`)).status,
          302,
        );
      },
    );
    await t.test(
      "courses, commission forms and settings are available only to administrators",
      async () => {
        for (const path of [
          "courses",
          "courses/new",
          "commissions/new",
          "settings",
          "payments/new",
          "notifications/new",
          "people/teacher/new",
        ]) {
          assert.equal((await aa.get(`/i/${a}/${path}`)).status, 200, path);
          assert.equal((await tt.get(`/i/${a}/${path}`)).status, 403, path);
        }
        assert.equal(
          (
            await post(aa, `/i/${a}/courses/new`, {
              name: "Another",
              level: "B2",
            })
          ).status,
          302,
        );
        const course = (
          await rows(
            "SELECT id FROM courses WHERE institute_id=? AND name='Another'",
            [a],
          )
        )[0].id;
        assert.equal(
          (
            await post(aa, `/i/${a}/courses/${course}/edit`, {
              name: "Another updated",
              level: "B2",
            })
          ).status,
          302,
        );
        assert.equal(
          (await post(aa, `/i/${a}/courses/${course}/toggle`)).status,
          302,
        );
        assert.equal(
          (
            await rows(
              "SELECT active FROM courses WHERE institute_id=? AND id=?",
              [a, course],
            )
          )[0].active,
          0,
        );
        assert.equal(
          (
            await post(aa, `/i/${a}/settings`, {
              due_day: "15",
              discount: "5",
              enrollment_enabled: "yes",
              payment_methods: "Efectivo\nTransferencia",
              reminders: "yes",
            })
          ).status,
          302,
        );
        const configured = (
          await rows("SELECT settings FROM institutes WHERE id=?", [a])
        )[0].settings;
        assert.equal(configured.dueDay, 15);
      },
    );
    await t.test(
      "simultaneous enrollment and payment requests preserve capacity and single payment",
      async () => {
        const other = (
          await write(
            "INSERT INTO people(institute_id,kind,first_name,last_name) VALUES (?,'student','Concurrent','Student')",
            [a],
          )
        ).insertId;
        const enroll = await Promise.all(
          [sid, other].map((person_id) =>
            post(aa, `/i/${a}/commissions/${c2}/enroll`, {
              person_id,
              discount: 0,
            }),
          ),
        );
        assert.deepEqual(enroll.map((r) => r.status).sort(), [302, 400]);
        const charge = (
          await write(
            "INSERT INTO charges(institute_id,person_id,kind,description,cents,due_date) VALUES (?,?,'manual','Concurrent',1000,?)",
            [a, sid, day],
          )
        ).insertId;
        const pays = await Promise.all(
          Array.from({ length: 2 }, () =>
            post(aa, `/i/${a}/payments/${charge}/pay`, {
              method: "Efectivo",
              paid_date: day,
            }),
          ),
        );
        assert.deepEqual(pays.map((r) => r.status).sort(), [302, 400]);
        assert.equal(
          (
            await rows(
              "SELECT COUNT(*) AS total FROM payments WHERE institute_id=? AND charge_id=?",
              [a, charge],
            )
          )[0].total,
          1,
        );
      },
    );
    await t.test(
      "public institute requests require valid data and CSRF without creating enabled accounts",
      async () => {
        const anonymous = request.agent(server);
        const initial = await anonymous.get("/request-institute");
        assert.equal(initial.status, 200);
        const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(initial.text)![1];
        const data = {
          institute_name: `Requested ${suffix}`,
          contact_name: "Responsible Person",
          email: `request-${suffix}@test.local`,
          phone: "123456",
          message: "We need access",
        };
        const userCount = (await rows("SELECT COUNT(*) AS total FROM users"))[0]
          .total;
        const instituteCount = (
          await rows("SELECT COUNT(*) AS total FROM institutes")
        )[0].total;
        assert.equal(
          (await anonymous.post("/request-institute").type("form").send(data))
            .status,
          403,
        );
        assert.equal(
          (
            await anonymous
              .post("/request-institute")
              .type("form")
              .send({ ...data, email: "invalid", _csrf: csrf })
          ).status,
          400,
        );
        const sent = await anonymous
          .post("/request-institute")
          .type("form")
          .send({ ...data, _csrf: csrf });
        assert.equal(sent.status, 200);
        assert.match(sent.text, /Solicitud enviada/);
        assert.equal(
          (await rows("SELECT COUNT(*) AS total FROM users"))[0].total,
          userCount,
        );
        assert.equal(
          (await rows("SELECT COUNT(*) AS total FROM institutes"))[0].total,
          instituteCount,
        );
        assert.equal(
          (
            await anonymous
              .post("/request-institute")
              .type("form")
              .send({ ...data, _csrf: csrf })
          ).status,
          400,
        );
        const entry = (
          await rows("SELECT * FROM institute_requests WHERE email=?", [
            data.email,
          ])
        )[0];
        assert.equal(entry.status, "pending");
        const dashboard = await oo.get("/platform");
        assert.equal(dashboard.status, 200);
        assert.match(dashboard.text, /Solicitudes pendientes/);
        assert.ok(dashboard.text.includes(data.institute_name));
        assert.ok(dashboard.text.includes(`/platform/requests/${entry.id}`));

        assert.equal((await aa.get("/platform/requests")).status, 403);
        assert.equal((await anonymous.get("/platform/requests")).status, 302);
        assert.equal(
          (await oo.get(`/platform/requests/${entry.id}`)).status,
          200,
        );
        const form = await oo.get(`/platform/new?request=${entry.id}`);
        assert.equal(form.status, 200);
        assert.ok(form.text.includes(data.email));
        assert.ok(form.text.includes(`name="_request_id" value="${entry.id}"`));
        assert.equal(
          (
            await post(oo, "/platform/new", {
              _request_id: entry.id,
              name: data.institute_name,
              slug: `requested-${suffix}`,
              contact_email: data.email,
              admin_email: data.email,
              phone: data.phone,
              plan: "Estándar",
              monthly: "1234.56",
              due_day: "12",
            })
          ).status,
          302,
        );
        const approved = (
          await rows("SELECT * FROM institute_requests WHERE id=?", [entry.id])
        )[0];
        assert.equal(approved.status, "approved");
        assert.equal(approved.reviewed_by, owner);
        assert.ok(approved.institute_id);
        assert.equal(
          (
            await rows(
              "SELECT COUNT(*) AS total FROM memberships WHERE institute_id=?",
              [approved.institute_id],
            )
          )[0].total,
          0,
        );
        const message = (
          await rows(
            "SELECT body FROM outbox WHERE recipient=? AND subject LIKE 'Invitación%' ORDER BY id DESC LIMIT 1",
            [data.email],
          )
        )[0].body;
        assert.match(message, /invite\/[a-f0-9]{64}/);
        assert.match(message, /1.234,56/);
        assert.equal(
          (
            await post(oo, "/platform/new", {
              _request_id: entry.id,
              name: data.institute_name,
              slug: `duplicate-requested-${suffix}`,
              contact_email: data.email,
              admin_email: data.email,
              phone: data.phone,
              plan: "Estándar",
              monthly: "1234.56",
              due_day: "12",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post(oo, `/platform/requests/${entry.id}/reject`, {
              reason: "No",
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "rejection requires a reason, emails the responsible and cannot be repeated",
      async () => {
        const anonymous = request.agent(server);
        const form = await anonymous.get("/request-institute");
        const csrf = /name="_csrf" value="([a-f0-9]+)"/.exec(form.text)![1];
        const data = {
          institute_name: `Rejected ${suffix}`,
          contact_name: "Responsible",
          email: `rejected-${suffix}@test.local`,
          _csrf: csrf,
        };
        assert.equal(
          (await anonymous.post("/request-institute").type("form").send(data))
            .status,
          200,
        );
        const entry = (
          await rows("SELECT id FROM institute_requests WHERE email=?", [
            data.email,
          ])
        )[0];
        assert.equal(
          (
            await post(aa, `/platform/requests/${entry.id}/reject`, {
              reason: "Unauthorized",
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await post(oo, `/platform/requests/${entry.id}/reject`, {
              reason: " ",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await post(oo, `/platform/requests/${entry.id}/reject`, {
              reason: "Necesitamos más información",
            })
          ).status,
          302,
        );
        const rejected = (
          await rows("SELECT * FROM institute_requests WHERE id=?", [entry.id])
        )[0];
        assert.equal(rejected.status, "rejected");
        assert.equal(rejected.institute_id, null);
        assert.equal(rejected.review_reason, "Necesitamos más información");
        const message = (
          await rows(
            "SELECT body FROM outbox WHERE recipient=? AND subject='Respuesta a tu solicitud de AulaNexo'",
            [data.email],
          )
        )[0].body;
        assert.match(message, /Necesitamos más información/);
        assert.equal(
          (
            await post(oo, `/platform/requests/${entry.id}/reject`, {
              reason: "Again",
            })
          ).status,
          400,
        );
        assert.equal(
          (await oo.get(`/platform/new?request=${entry.id}`)).status,
          400,
        );
      },
    );
    await t.test(
      "50 concurrent authenticated dashboard requests remain within the stated latency",
      async () => {
        const start = performance.now();
        const responses = await Promise.all(
          Array.from({ length: 50 }, () => aa.get(`/i/${a}`)),
        );
        assert.ok(responses.every((r) => r.status === 200));
        const elapsed = performance.now() - start;
        assert.ok(
          elapsed < 5000,
          `50 concurrent requests took ${elapsed.toFixed(0)} ms`,
        );
      },
    );
  },
);
