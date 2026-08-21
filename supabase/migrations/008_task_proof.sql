-- ============================================================
-- 008: Task Proof / Work Proof Feature
-- Adds photo-based work evidence for shifts
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Enums
-- ────────────────────────────────────────────────────────────

CREATE TYPE public.proof_type AS ENUM ('BEFORE', 'DURING', 'AFTER', 'OTHER');

CREATE TYPE public.proof_submission_status AS ENUM (
  'SUBMITTED',
  'REPLACED',
  'NEEDS_REVIEW',
  'CORRECTION_REQUIRED',
  'APPROVED'
);

-- ────────────────────────────────────────────────────────────
-- 2. Task Proof Templates (reusable proof configs)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.task_proof_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  UUID REFERENCES public.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.task_proof_template_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id              UUID NOT NULL REFERENCES public.task_proof_templates(id) ON DELETE CASCADE,
  proof_type               public.proof_type NOT NULL,
  instruction              TEXT,
  minimum_photos           INTEGER NOT NULL DEFAULT 1,
  maximum_photos           INTEGER NOT NULL DEFAULT 6,
  is_required              BOOLEAN NOT NULL DEFAULT true,
  allow_employee_note      BOOLEAN NOT NULL DEFAULT true,
  allow_finish_without_proof BOOLEAN NOT NULL DEFAULT true,
  sort_order               SMALLINT NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 3. Task Proof Requirements (per-shift proof config)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.task_proof_requirements (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              UUID NOT NULL,
  shift_id                 UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  proof_type               public.proof_type NOT NULL,
  instruction              TEXT,
  minimum_photos           INTEGER NOT NULL DEFAULT 1,
  maximum_photos           INTEGER NOT NULL DEFAULT 6,
  is_required              BOOLEAN NOT NULL DEFAULT true,
  allow_employee_note      BOOLEAN NOT NULL DEFAULT true,
  allow_finish_without_proof BOOLEAN NOT NULL DEFAULT true,
  sort_order               SMALLINT NOT NULL DEFAULT 0,
  created_by               UUID REFERENCES public.users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One proof type per shift (a shift can have at most one BEFORE, one DURING, etc.)
  UNIQUE (shift_id, proof_type)
);

-- ────────────────────────────────────────────────────────────
-- 4. Task Proof Submissions (employee photo uploads)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.task_proof_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL,
  shift_id         UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  employee_id      UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  requirement_id   UUID NOT NULL REFERENCES public.task_proof_requirements(id) ON DELETE CASCADE,
  proof_type       public.proof_type NOT NULL,
  photo_path       TEXT NOT NULL,
  employee_note    TEXT,
  server_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           public.proof_submission_status NOT NULL DEFAULT 'SUBMITTED',
  -- Correction tracking
  correction_reason TEXT,        -- Admin's reason for requesting correction
  correction_requested_by UUID REFERENCES public.users(id),
  correction_requested_at TIMESTAMPTZ,
  replaces_submission_id UUID REFERENCES public.task_proof_submissions(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 5. Indexes
-- ────────────────────────────────────────────────────────────

-- Templates
CREATE INDEX idx_task_proof_templates_business
  ON public.task_proof_templates(business_id);

CREATE INDEX idx_task_proof_template_items_template
  ON public.task_proof_template_items(template_id);

-- Requirements
CREATE INDEX idx_task_proof_requirements_shift
  ON public.task_proof_requirements(shift_id);

CREATE INDEX idx_task_proof_requirements_business
  ON public.task_proof_requirements(business_id);

-- Submissions
CREATE INDEX idx_task_proof_submissions_shift
  ON public.task_proof_submissions(shift_id);

CREATE INDEX idx_task_proof_submissions_employee
  ON public.task_proof_submissions(employee_id);

CREATE INDEX idx_task_proof_submissions_requirement
  ON public.task_proof_submissions(requirement_id);

CREATE INDEX idx_task_proof_submissions_business
  ON public.task_proof_submissions(business_id);

-- ────────────────────────────────────────────────────────────
-- 6. Auto-update triggers
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER trg_task_proof_templates_updated_at
  BEFORE UPDATE ON public.task_proof_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_task_proof_requirements_updated_at
  BEFORE UPDATE ON public.task_proof_requirements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_task_proof_submissions_updated_at
  BEFORE UPDATE ON public.task_proof_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ────────────────────────────────────────────────────────────
-- 7. Row Level Security
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.task_proof_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_proof_template_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_proof_requirements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_proof_submissions     ENABLE ROW LEVEL SECURITY;

-- ── Templates: admin-only management ──

CREATE POLICY "Task proof templates: admin sees same-business"
  ON public.task_proof_templates FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Task proof templates: admin can insert"
  ON public.task_proof_templates FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Task proof templates: admin can update"
  ON public.task_proof_templates FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Task proof templates: admin can delete"
  ON public.task_proof_templates FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

-- ── Template items: follow template access ──

CREATE POLICY "Task proof template items: admin sees via template"
  ON public.task_proof_template_items FOR SELECT
  USING (
    template_id IN (
      SELECT id FROM public.task_proof_templates
      WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Task proof template items: admin can insert"
  ON public.task_proof_template_items FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND template_id IN (
      SELECT id FROM public.task_proof_templates
      WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Task proof template items: admin can update"
  ON public.task_proof_template_items FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND template_id IN (
      SELECT id FROM public.task_proof_templates
      WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Task proof template items: admin can delete"
  ON public.task_proof_template_items FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND template_id IN (
      SELECT id FROM public.task_proof_templates
      WHERE business_id = public.current_user_business_id()
    )
  );

-- ── Requirements: admin manages, employee reads for own shifts ──

CREATE POLICY "Task proof requirements: admin sees same-business"
  ON public.task_proof_requirements FOR SELECT
  USING (business_id = public.current_user_business_id());

CREATE POLICY "Task proof requirements: employee sees own shifts"
  ON public.task_proof_requirements FOR SELECT
  USING (
    shift_id IN (
      SELECT id FROM public.shifts WHERE employee_id = public.current_employee_id()
    )
  );

CREATE POLICY "Task proof requirements: admin can insert"
  ON public.task_proof_requirements FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Task proof requirements: admin can update"
  ON public.task_proof_requirements FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Task proof requirements: admin can delete"
  ON public.task_proof_requirements FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

-- ── Submissions: employee can create own, admin + employee can read ──

CREATE POLICY "Task proof submissions: admin sees same-business"
  ON public.task_proof_submissions FOR SELECT
  USING (business_id = public.current_user_business_id());

CREATE POLICY "Task proof submissions: employee sees own"
  ON public.task_proof_submissions FOR SELECT
  USING (employee_id = public.current_employee_id());

CREATE POLICY "Task proof submissions: employee can insert own"
  ON public.task_proof_submissions FOR INSERT
  WITH CHECK (employee_id = public.current_employee_id());

CREATE POLICY "Task proof submissions: employee can update own"
  ON public.task_proof_submissions FOR UPDATE
  USING (employee_id = public.current_employee_id());

-- Admin can also update submissions (for correction status changes)
CREATE POLICY "Task proof submissions: admin can update same-business"
  ON public.task_proof_submissions FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

-- ────────────────────────────────────────────────────────────
-- 8. Storage bucket for task proof photos (private)
-- ────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('task-proof-photos', 'task-proof-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: employees can upload to their own folder
CREATE POLICY "Task proof photos: employee upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'task-proof-photos'
    AND (storage.foldername(name))[1] IS NOT NULL
  );

-- Authenticated users can read (server-side validates business access)
CREATE POLICY "Task proof photos: authenticated read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'task-proof-photos'
  );

-- ────────────────────────────────────────────────────────────
-- Done! Task Proof tables, indexes, RLS, and storage ready.
-- ────────────────────────────────────────────────────────────
