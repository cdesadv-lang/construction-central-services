// Configurable approval workflow engine (per company, per document type) with full history.
import type { Role } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { forbidden, notFound, unprocessable } from "@/lib/errors";
import type { Ctx } from "../context";
import { assertCompany, requirePerm, can } from "../context";
import { audit } from "../audit";
import { notifyRole, notifyUsers } from "./notifications";
import { DOC_TYPES, type DocType } from "./doctypes";

/* eslint-disable @typescript-eslint/no-explicit-any */
type StepSnap = { order: number; name: string; role: Role };

export async function resolveWorkflow(tx: Tx, companyId: string, docType: DocType): Promise<StepSnap[]> {
  const wf =
    (await tx.approvalWorkflow.findFirst({ where: { companyId, docType, isActive: true }, include: { steps: { orderBy: { order: "asc" } } } })) ??
    (await tx.approvalWorkflow.findFirst({ where: { companyId: null, docType, isActive: true }, include: { steps: { orderBy: { order: "asc" } } } }));
  return (wf?.steps ?? []).map((s) => ({ order: s.order, name: s.name, role: s.role }));
}

const model = (tx: Tx, docType: DocType) => (tx as any)[DOC_TYPES[docType].model];

export async function submitForApproval(tx: Tx, ctx: Ctx, docType: DocType, docId: string) {
  const meta = DOC_TYPES[docType];
  if (!can(ctx, meta.module, "create") && !can(ctx, meta.module, "edit")) throw forbidden();
  const doc = await model(tx, docType).findUnique({ where: { id: docId } });
  if (!doc) throw notFound();
  assertCompany(ctx, doc.companyId);
  if (doc.status !== "DRAFT") throw unprocessable(`Only drafts can be submitted (current: ${doc.status})`);
  const steps = await resolveWorkflow(tx, doc.companyId, docType);
  const docNumber = doc.number ?? null;
  if (!steps.length) {
    await model(tx, docType).update({ where: { id: docId }, data: { status: "APPROVED" } });
    await audit(tx, ctx, { action: "SUBMIT_AUTO_APPROVE", entity: meta.model, entityId: docId, companyId: doc.companyId });
    return { status: "APPROVED", request: null };
  }
  const request = await tx.approvalRequest.create({
    data: {
      companyId: doc.companyId,
      docType,
      docId,
      docNumber,
      steps: steps as any,
      totalSteps: steps.length,
      currentStep: 1,
      submittedBy: ctx.user.id,
      actions: { create: { stepOrder: 0, userId: ctx.user.id, action: "SUBMIT" } },
    },
  });
  await model(tx, docType).update({ where: { id: docId }, data: { status: "PENDING_APPROVAL" } });
  await notifyRole(tx, doc.companyId, steps[0].role, {
    type: "APPROVAL_REQUEST",
    title: `طلب اعتماد: ${meta.label} ${docNumber ?? ""}`,
    body: `${steps[0].name} — مقدم من ${ctx.user.name}`,
    link: "/approvals",
  });
  await audit(tx, ctx, { action: "SUBMIT", entity: meta.model, entityId: docId, companyId: doc.companyId, after: { requestId: request.id } });
  return { status: "PENDING_APPROVAL", request };
}

export async function actOnRequest(tx: Tx, ctx: Ctx, requestId: string, decision: "APPROVE" | "REJECT", comment?: string) {
  const req = await tx.approvalRequest.findUnique({ where: { id: requestId } });
  if (!req) throw notFound("Approval request not found");
  assertCompany(ctx, req.companyId);
  if (req.status !== "PENDING") throw unprocessable("Request is no longer pending");
  const steps = req.steps as unknown as StepSnap[];
  const step = steps[req.currentStep - 1];
  if (ctx.role !== "SUPER_ADMIN" && ctx.role !== step.role) throw forbidden(`This step requires role ${step.role}`);
  if (ctx.role !== "SUPER_ADMIN" && req.submittedBy === ctx.user.id) throw forbidden("You cannot approve a document you submitted");
  const docType = req.docType as DocType;
  const meta = DOC_TYPES[docType];
  requirePerm(ctx, meta.module, "approve");
  await tx.approvalAction.create({ data: { requestId, stepOrder: step.order, userId: ctx.user.id, action: decision, comment } });
  const m = model(tx, docType);
  if (decision === "REJECT") {
    await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "REJECTED" } });
    await m.update({ where: { id: req.docId }, data: { status: "DRAFT" } });
    await notifyUsers(tx, [req.submittedBy], {
      companyId: req.companyId,
      type: "APPROVAL_REJECTED",
      title: `تم رفض ${meta.label} ${req.docNumber ?? ""}`,
      body: comment ?? undefined,
      link: meta.link,
    });
    await audit(tx, ctx, { action: "REJECT", entity: meta.model, entityId: req.docId, companyId: req.companyId, after: { comment } });
    return { status: "REJECTED" };
  }
  if (req.currentStep >= req.totalSteps) {
    await tx.approvalRequest.update({ where: { id: requestId }, data: { status: "APPROVED" } });
    await m.update({
      where: { id: req.docId },
      data: { status: "APPROVED", ...(docType === "JOURNAL" ? { approvedById: ctx.user.id } : {}) },
    });
    await notifyUsers(tx, [req.submittedBy], {
      companyId: req.companyId,
      type: "APPROVAL_APPROVED",
      title: `تم اعتماد ${meta.label} ${req.docNumber ?? ""} — جاهز للترحيل`,
      link: meta.link,
    });
    await audit(tx, ctx, { action: "APPROVE", entity: meta.model, entityId: req.docId, companyId: req.companyId, after: { final: true, comment } });
    return { status: "APPROVED" };
  }
  const next = steps[req.currentStep];
  await tx.approvalRequest.update({ where: { id: requestId }, data: { currentStep: req.currentStep + 1 } });
  await notifyRole(tx, req.companyId, next.role, {
    type: "APPROVAL_REQUEST",
    title: `طلب اعتماد: ${meta.label} ${req.docNumber ?? ""}`,
    body: `${next.name}`,
    link: "/approvals",
  });
  await audit(tx, ctx, { action: "APPROVE_STEP", entity: meta.model, entityId: req.docId, companyId: req.companyId, after: { step: step.order, comment } });
  return { status: "PENDING_APPROVAL", currentStep: req.currentStep + 1 };
}

export async function pendingRequestFor(tx: Tx, docType: DocType, docId: string) {
  return tx.approvalRequest.findFirst({ where: { docType, docId, status: "PENDING" } });
}

export async function cancelDocument(tx: Tx, ctx: Ctx, docType: DocType, docId: string) {
  const m = model(tx, docType);
  const doc = await m.findUnique({ where: { id: docId } });
  if (!doc) throw notFound();
  assertCompany(ctx, doc.companyId);
  if (!["DRAFT", "PENDING_APPROVAL", "APPROVED"].includes(doc.status)) throw unprocessable("Posted documents must be reversed, not cancelled");
  await tx.approvalRequest.updateMany({ where: { docType, docId, status: "PENDING" }, data: { status: "CANCELLED" } });
  await m.update({ where: { id: docId }, data: { status: "CANCELLED" } });
  await audit(tx, ctx, { action: "CANCEL", entity: DOC_TYPES[docType].model, entityId: docId, companyId: doc.companyId, before: { status: doc.status } });
  return m.findUnique({ where: { id: docId } });
}

export async function approvalHistory(tx: Tx, docType: string, docId: string) {
  return tx.approvalRequest.findMany({
    where: { docType, docId },
    orderBy: { createdAt: "asc" },
    include: { actions: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true, role: true } } } } },
  });
}
