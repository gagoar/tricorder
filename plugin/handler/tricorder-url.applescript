on open location this_URL
	set binPath to (POSIX path of (path to home folder)) & ".claude/tricorder-src/plugin/bin/tricorder"
	if this_URL is "tricorder://warp" then
		-- Script iTerm2 directly (no it2 auth needed): open a tab and fly the ship.
		tell application "iTerm2"
			activate
			if (count of windows) is 0 then
				create window with default profile
			end if
			tell current window
				set newTab to (create tab with default profile)
				tell current session of newTab to write text binPath & " warp"
			end tell
		end tell
	else
		set shPath to (POSIX path of (path to home folder)) & ".claude/tricorder-src/plugin/handler/handle-url.sh"
		do shell script quoted form of shPath & " " & quoted form of this_URL
	end if
end open location
