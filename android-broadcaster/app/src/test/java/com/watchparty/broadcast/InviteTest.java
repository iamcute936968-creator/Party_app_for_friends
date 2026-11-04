package com.watchparty.broadcast;

import org.junit.Test;
import static org.junit.Assert.*;

public class InviteTest {
    @Test public void parsesTheExistingPrivateRoomInvitationWithoutReturningItInToString() {
        Invite invite = Invite.parse("https://partyapp-fun.netlify.app/?room=ABC123&s=private-secret", "Phone");
        assertEquals("ABC123", invite.roomId()); assertEquals("private-secret", invite.secret());
        assertFalse(invite.toString().contains("private-secret"));
    }
    @Test public void rejectsUnsafeRoomKeysNamesOriginsAndDuplicateParameters() {
        for (String url : new String[]{"javascript:alert(1)", "http://partyapp-fun.netlify.app/?room=ABC123&s=x",
                "https://evil.example/?room=ABC123&s=x", "https://partyapp-fun.netlify.app/?room=bad%2Fkey&s=x",
                "https://partyapp-fun.netlify.app/?room=ABC123", "https://partyapp-fun.netlify.app/?room=ABC123&room=OTHER&s=x"}) {
            assertThrows(IllegalArgumentException.class, () -> Invite.parse(url, "Phone"));
        }
        for (String name : new String[]{"", "bad/name", "bad.name", "bad#name", "bad\nname", "x".repeat(41)}) {
            assertThrows(IllegalArgumentException.class, () -> Invite.parse("https://partyapp-fun.netlify.app/?room=ABC123&s=x", name));
        }
    }
}
