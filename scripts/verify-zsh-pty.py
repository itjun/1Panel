# Remote interactive zsh verification using a temporary history file.
# Usage after installation: ssh -T template 'python3 -' < scripts/verify-zsh-pty.py
import os, pty, select, subprocess, tempfile, time, shutil, json, re
base=tempfile.mkdtemp(prefix='1panel-zsh-functional-')
master, slave=pty.openpty()
env=os.environ.copy();env.update(TERM='xterm-256color',HISTFILE=base+'/history',LC_ALL='C.UTF-8')
p=subprocess.Popen(['zsh','-i'],stdin=slave,stdout=slave,stderr=slave,env=env,start_new_session=True)
os.close(slave)
transcript=b''
def read_for(seconds=0.5):
    global transcript
    data=b''; end=time.monotonic()+seconds
    while time.monotonic()<end:
        available,_,_=select.select([master],[],[],max(0,end-time.monotonic()))
        if not available: break
        try: chunk=os.read(master,65536)
        except OSError: break
        data+=chunk
    transcript+=data
    return data
def send(data): os.write(master,data.encode() if isinstance(data,str) else data)
try:
    read_for(0.5)
    send('print -r -- "1PANEL_OMZ=$+functions[_omz_source] 1PANEL_THEME=$ZSH_THEME"\n')
    framework=read_for(0.5)
    assert b'1PANEL_OMZ=1 1PANEL_THEME=ys' in framework, ('Oh My Zsh and ys loading', repr(framework))
    # Use a fixed prompt to delimit reads; no prompt setting is written to disk.
    send("PROMPT='1PANEL> '; RPROMPT=''; bindkey -e\n")
    read_for(0.3)
    send('true')
    valid=read_for(0.3)
    send(b'\x15')
    read_for(0.1)
    send('__1panel_unknown_command__')
    unknown=read_for(0.3)
    send(b'\x15')
    read_for(0.1)
    assert b'\x1b[32m' in valid, ('known-command coloring', repr(valid))
    assert b'\x1b[31m' in unknown, ('unknown-command coloring', repr(unknown))
    send("prnit -r -- 1PANEL_CORRECTION_DISABLED\n")
    correction=read_for(0.5)
    assert b"correct 'prnit'" not in correction and b'command not found: prnit' in correction, ('correction should be disabled', repr(correction))
    send('print -r -- 1PANEL_HISTORY_SUGGESTION_PASS\n')
    read_for(0.3)
    send('print -r -- 1PANEL_HISTORY_')
    suggestion=read_for(0.5)
    assert b'SUGGESTION_PASS' in suggestion and (b'\x1b[90m' in suggestion or b'\x1b[38;5;8m' in suggestion), ('history suggestion', repr(suggestion))
    send(b'\x1b[C')
    accepted=read_for(0.2)
    send('\n')
    executed=read_for(0.3)
    assert b'1PANEL_HISTORY_SUGGESTION_PASS' in executed, ('right-arrow acceptance', repr(accepted+executed))
    send("print -r -- \"CORRECT=$options[correct] CORRECTALL=$options[correctall] HIGHLIGHT=$+functions[_zsh_highlight] SUGGEST=$+functions[_zsh_autosuggest_start]\"\n")
    options=read_for(0.3)
    assert b'CORRECT=off CORRECTALL=off' in options, ('correction options',repr(options))
    send('exit\n')
    read_for(0.2)
    p.wait(timeout=5)
    print(json.dumps({'pty':True,'ohMyZshLoaded':True,'theme':'ys','knownCommandGreen':True,'unknownCommandRed':True,'correctionDisabled':True,'correctAllDisabled':True,'historySuggestionGray':True,'rightArrowAcceptance':True,'exitCode':p.returncode},ensure_ascii=False))
    print('PTY_FUNCTIONAL_PASS')
except BaseException:
    # Include only this synthetic test session, never the user's history.
    print('PTY_TRANSCRIPT='+repr(transcript))
    raise
finally:
    if p.poll() is None: p.terminate();p.wait(timeout=5)
    os.close(master)
    shutil.rmtree(base)
