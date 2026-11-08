"""Execute scope decisions against complete immutable synthetic Git trees."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from scripts.verification_plan import plan

ROOT = Path(__file__).resolve().parents[1]

class VerificationPlanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Synthetic Example')
        self.git('config', 'user.email', 'bot@noreply.github.com')
        for name, text in {'README.md':'old', 'docs/guide.md':'old', 'assets/app.js':'trusted runtime',
                           'docs/DATA-BOUNDARY.md':'protected', 'updates/manifest.json':json.dumps({'stable':{'version':'0.10.17'},'beta':{}})}.items():
            self.write(name, text)
        self.base = self.commit()

    def tearDown(self): self.tmp.cleanup()
    def git(self,*args):
        return subprocess.check_output(['git','-C',str(self.root),*args],stderr=subprocess.DEVNULL).decode().strip()
    def write(self,name,text):
        p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text)
    def commit(self):
        self.git('add','.');self.git('commit','-qm','Synthetic scope fixture');return self.git('rev-parse','HEAD')
    def scope(self): return plan(self.root,self.base,self.commit())['scope']

    def test_ordinary_documents_do_not_require_unrelated_runtime_or_browser_tests(self):
        self.write('docs/guide.md','new');self.assertEqual(self.scope(),'documentation')
    def test_readme_and_changelog_are_documentation(self):
        self.write('README.md','new');self.write('CHANGELOG.md','new');self.assertEqual(self.scope(),'documentation')
    def test_runtime_tests_policy_unknown_and_previous_names_cannot_select_fast_path(self):
        for name in ['assets/app.js','tests/new.test.cjs','.github/workflows/new.yml','scripts/verification_plan.py','docs/DATA-BOUNDARY.md','unknown.txt']:
            with self.subTest(name=name):
                self.git('reset','--hard',self.base);self.git('clean','-fd');self.write(name,'new')
                self.assertEqual(self.scope(),'full')
        self.git('reset','--hard',self.base);self.git('clean','-fd')
        self.git('mv','docs/DATA-BOUNDARY.md','docs/ordinary.md')
        self.assertEqual(self.scope(),'full')
    def test_symlink_executable_mode_and_submodule_fail_closed(self):
        self.write('docs/run.md','new');os.chmod(self.root/'docs/run.md',0o755)
        self.assertEqual(self.scope(),'full')
        self.git('reset','--hard',self.base);self.git('clean','-fd')
        (self.root/'docs/link.md').symlink_to('../assets/app.js');self.assertEqual(self.scope(),'full')
        self.git('reset','--hard',self.base);self.git('clean','-fd')
        self.git('update-index','--add','--cacheinfo','160000,'+self.base+',docs/module.md')
        self.git('commit','-qm','Synthetic gitlink')
        self.assertEqual(plan(self.root,self.base,self.git('rev-parse','HEAD'))['scope'],'full')
    def test_beta_metadata_retains_installation_and_contract_checks(self):
        self.write('updates/manifest.json',json.dumps({'stable':{'version':'0.10.17'},'beta':{'version':'new'}}))
        self.write('updates/packages/moondog-0.10.18-beta.404.json','synthetic envelope; validation is a separate blocking gate')
        self.assertEqual(self.scope(),'package-metadata')
    def test_stable_change_malformed_manifest_and_package_only_remain_full(self):
        for text in ['{}','invalid',json.dumps({'stable':{'version':'different'},'beta':{}})]:
            self.git('reset','--hard',self.base);self.write('updates/manifest.json',text)
            self.assertEqual(self.scope(),'full')
        self.git('reset','--hard',self.base)
        self.write('updates/packages/moondog-0.10.18-beta.404.json','unknown');self.assertEqual(self.scope(),'full')
    def test_empty_invalid_unavailable_or_unrelated_revisions_remain_full(self):
        for base,head in [(self.base,self.base),('bad',self.base),('a'*40,self.base)]:
            self.assertEqual(plan(self.root,base,head)['scope'],'full')
        self.git('checkout','--orphan','unrelated');self.git('rm','-rf','.')
        self.write('README.md','new');head=self.commit()
        self.assertEqual(plan(self.root,self.base,head)['scope'],'full')
    def test_working_tree_claims_cannot_hide_changed_runtime(self):
        self.write('assets/app.js','changed runtime');head=self.commit()
        self.write('assets/app.js','trusted runtime');self.write('.verification-plan.json','{"scope":"documentation"}')
        self.assertEqual(plan(self.root,self.base,head)['scope'],'full')

    def test_real_workflow_shell_ignores_candidate_classifier_and_checks_exact_merge_parents(self):
        trusted=(ROOT/'scripts/verification_plan.py').read_text()
        self.write('scripts/verification_plan.py',trusted);self.base=self.commit()
        shell=(ROOT/'.github/workflows/clean-install-proof.yml').read_text().split('      - name: Classify exact pull request change scope',1)[1].split('      - name:',1)[0]
        shell=shell.split('        run: |\n',1)[1]
        shell='\n'.join(line[10:]for line in shell.splitlines())
        def execute(head,expected_head=None):
            tree=self.git('rev-parse',head+'^{tree}')
            merge=self.git('commit-tree',tree,'-p',self.base,'-p',head,'-m','Synthetic GitHub merge')
            with tempfile.TemporaryDirectory()as td:
                output=Path(td)/'outputs'
                env={**os.environ,'GITHUB_EVENT_NAME':'pull_request','GITHUB_SHA':merge,
                     'PR_BASE_SHA':self.base,'PR_HEAD_SHA':expected_head or head,
                     'RUNNER_TEMP':td,'GITHUB_OUTPUT':str(output)}
                run=subprocess.run(['bash','-c',shell],cwd=self.root,env=env,capture_output=True)
                return run.returncode,output.read_text()if output.exists()else ''
        self.write('docs/guide.md','new');head=self.commit()
        self.assertEqual(execute(head),(0,'scope=documentation\n'))
        self.write('assets/app.js','changed runtime')
        self.write('scripts/verification_plan.py',"raise SystemExit('candidate helper must never execute')")
        head=self.commit()
        self.assertEqual(execute(head),(0,'scope=full\n'))
        code,output=execute(head,self.base);self.assertNotEqual(code,0);self.assertEqual(output,'')


class VerificationWorkflowTests(unittest.TestCase):
    def test_both_workflows_execute_only_base_classifier_with_bootstrap_full_fallback(self):
        for name in ['publication-check','clean-install-proof']:
            text=(ROOT/'.github/workflows'/f'{name}.yml').read_text()
            self.assertIn('git show "$base:scripts/verification_plan.py" > "$helper"',text)
            self.assertIn('echo \'scope=full\' >> "$GITHUB_OUTPUT"',text)
            self.assertIn('test "$(git rev-parse "${GITHUB_SHA}^2")" = "$head"',text)
            self.assertNotIn('python3 scripts/verification_plan.py',text)
    def test_publication_aggregator_rejects_failures_cancelled_skipped_missing_unknown(self):
        text=(ROOT/'.github/workflows/publication-check.yml').read_text()
        block=text.split('      - name: Require every functional and security result',1)[1]
        code=block.split("          python3 - <<'PY'\n",1)[1].split('\n          PY',1)[0]
        code='\n'.join(line[10:] for line in code.splitlines())
        import sys
        expected=['public-boundary','history-boundary','history-strict']
        def run(results):
            env={**os.environ,'RESULTS':json.dumps(results)}
            return subprocess.run([sys.executable,'-c',code],env=env,capture_output=True).returncode
        self.assertEqual(run({k:{'result':'success'}for k in expected}),0)
        for result in ['failure','cancelled','skipped','unknown',None]:
            for key in expected:
                values={k:{'result':'success'}for k in expected};values[key]={'result':result}
                self.assertNotEqual(run(values),0)
        self.assertNotEqual(run({}),0)
        self.assertIn('needs: [public-boundary, history-boundary, history-strict]',text)
        self.assertIn('if: always()',text)
    def test_focused_and_remaining_node_commands_cover_each_test_once(self):
        text=(ROOT/'.github/workflows/publication-check.yml').read_text()
        import ast
        focused=text.split('      - name: Run focused production-path regressions',1)[1].split('      - name:',1)[0]
        command=focused.split('run: node --test ',1)[1].strip()
        expected=set(command.split())
        block=text.split('      - name: Test browser update check',1)[1].split('      - name:',1)[0]
        line=next(x.strip() for x in block.splitlines()if x.strip().startswith('focused = '))
        excluded=ast.literal_eval(line.split('=',1)[1].strip())
        remaining={str(p.relative_to(ROOT))for p in (ROOT/'tests').glob('*.test.cjs')if p.name.removesuffix('.test.cjs')not in excluded}
        complete={str(p.relative_to(ROOT))for p in (ROOT/'tests').glob('*.test.cjs')}
        self.assertFalse(expected&remaining);self.assertEqual(expected|remaining,complete)
    def test_no_security_scan_is_skipped_or_cached_by_scope(self):
        text=(ROOT/'.github/workflows/publication-check.yml').read_text()
        for job,script in [('history-boundary','audit_git_history.py'),('history-strict','audit_public_git_history.py')]:
            block=text.split('  '+job+':',1)[1]
            self.assertIn('python3 scripts/'+script,block)
        clean=(ROOT/'.github/workflows/clean-install-proof.yml').read_text()
        self.assertIn("key: distribution-vendor-v1-${{ runner.os }}-${{ hashFiles('distribution/dependencies.json', 'scripts/prepare_distribution_vendor.sh') }}",clean)
        self.assertLess(clean.index('python3 scripts/verify_distribution_vendor.py'),clean.index('python3 scripts/build_distribution.py --vendor-dir'))

if __name__=='__main__':unittest.main()
